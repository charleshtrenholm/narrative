# Adapted from a Karma test startup script
# developebd by the Jupyter team here;
# https://github.com/jupyter/jupyter-js-services/blob/master/test/run_test.py
#
# Also uses the flow where we assign a os process group id and shut down the
# server based on that - since the subprocess actually executes the kbase-narrative
# script.
# (recipe here)
# http://stackoverflow.com/questions/4789837/how-to-terminate-a-python-subprocess-launched-with-shell-true

import subprocess
import sys
import argparse
import threading
import time
import os
import signal

KARMA_PORT = 9876
JUPYTER_PORT = 32323

argparser = argparse.ArgumentParser(description="Run KBase Narrative unit tests")
argparser.add_argument(
    "-b", "--browsers", default="Firefox", help="Browsers to use for Karma test"
)
argparser.add_argument(
    "-d", "--debug", action="store_true", help="Whether to enter debug mode in Karma"
)
argparser.add_argument(
    "-u", "--unit", action="store_true", help="Whether to run unit tests"
)
argparser.add_argument(
    "-i", "--integration", action="store_true", help="Whether to run integration tests"
)
options = argparser.parse_args(sys.argv[1:])

nb_command = [
    "kbase-narrative",
    "--no-browser",
    '--NotebookApp.allow_origin="*"',
    "--ip=127.0.0.1",
    "--port={}".format(JUPYTER_PORT),
]

if not hasattr(sys, "real_prefix"):
    nb_command[0] = "kbase-narrative"

nb_server = subprocess.Popen(
    nb_command, stderr=subprocess.STDOUT, stdout=subprocess.PIPE, preexec_fn=os.setsid
)

# wait for notebook server to start up
while 1:
    line = nb_server.stdout.readline().decode("utf-8").strip()
    if not line:
        continue
    print(line)
    if "The Jupyter Notebook is running at:" in line:
        break
    if "is already in use" in line:
        os.killpg(os.getpgid(nb_server.pid), signal.SIGTERM)
        # nb_server.terminate()
        raise ValueError(
            "The port {} was already taken, kill running notebook servers".format(
                JUPYTER_PORT
            )
        )


def readlines():
    """Print the notebook server output."""
    while 1:
        line = nb_server.stdout.readline().decode("utf-8").strip()
        if line:
            print(line)


thread = threading.Thread(target=readlines)
thread.setDaemon(True)
thread.start()

print("Jupyter server started!")

resp_unit = 0
resp_integration = 0
try:
    if options.unit:
        print("starting unit tests")
        try:
            resp_unit = subprocess.check_call(
                ["grunt", "test"], stderr=subprocess.STDOUT
            )
        except subprocess.CalledProcessError:
            resp_unit = 1
    if options.integration:
        base_url = f"http://localhost:{JUPYTER_PORT}"
        env = os.environ.copy()
        env["BASE_URL"] = base_url
        print("starting integration tests")
        try:
            resp_integration = subprocess.check_call(
                [
                    "node",
                    "test/integration/launcher.js",
                    "test/integration/wdio.conf.js",
                ],
                stderr=subprocess.STDOUT,
                env=env,
            )
        except subprocess.CalledProcessError:
            resp_integration = 1
finally:
    print("Done running tests, killing server.")
    os.killpg(os.getpgid(nb_server.pid), signal.SIGTERM)
    sys.exit(resp_unit + resp_integration)
