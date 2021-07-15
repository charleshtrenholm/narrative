import unittest
from unittest import mock
import os

import biokbase.narrative.jobs.jobcomm
import biokbase.narrative.jobs.jobmanager
from biokbase.narrative.jobs.jobcomm import JobRequest
from biokbase.narrative.exception_util import JobException, NarrativeException
from .util import ConfigTests, validate_job_state
from .narrative_mock.mockcomm import MockComm
from .narrative_mock.mockclients import get_mock_client, get_failing_mock_client
from .test_job import (
    JOB_COMPLETED,
    JOB_CREATED,
    JOB_RUNNING,
    JOB_TERMINATED,
    BATCH_PARENT,
    BATCH_COMPLETED,
    BATCH_TERMINATED,
    BATCH_TERMINATED_RETRIED,
    BATCH_ERROR_RETRIED,
    BATCH_RETRY_COMPLETED,
    BATCH_RETRY_RUNNING,
    BATCH_RETRY_ERROR,
    ALL_JOBS,
    FINISHED_JOBS,
    ACTIVE_JOBS,
)

config = ConfigTests()
test_jobs = config.load_json_file(config.get("jobs", "ee2_job_info_file"))
JOB_NOT_FOUND = "job_not_found"


def make_comm_msg(
    msg_type: str, job_id_like, as_job_request: bool, content: dict = None
):
    if type(job_id_like) is list:
        job_id_key = "job_id_list"
    else:
        job_id_key = "job_id"
    msg = {
        "msg_id": "some_id",
        "content": {"data": {"request_type": msg_type, job_id_key: job_id_like}},
    }
    if content is not None:
        msg["content"]["data"].update(content)
    if as_job_request:
        return JobRequest(msg)
    else:
        return msg


class JobCommTestCase(unittest.TestCase):
    @classmethod
    @mock.patch("biokbase.narrative.jobs.jobcomm.Comm", MockComm)
    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def setUpClass(cls):
        cls.jm = biokbase.narrative.jobs.jobmanager.JobManager()
        cls.job_ids = list(test_jobs.keys())
        os.environ["KB_WORKSPACE_ID"] = config.get("jobs", "job_test_wsname")

        cls.jc = biokbase.narrative.jobs.jobcomm.JobComm()
        cls.jc._comm = MockComm()

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def setUp(self):
        self.jc._comm.clear_message_cache()
        self.jc._jm.initialize_jobs()

    def test_send_comm_msg_ok(self):
        self.jc.send_comm_message("some_msg", {"foo": "bar"})
        msg = self.jc._comm.last_message
        self.assertDictEqual(
            msg,
            {
                "content": None,
                "data": {"content": {"foo": "bar"}, "msg_type": "some_msg"},
            },
        )
        self.jc._comm.clear_message_cache()

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_start_stop_job_status_loop(self):
        self.assertFalse(self.jc._running_lookup_loop)
        self.assertIsNone(self.jc._lookup_timer)

        self.jc.start_job_status_loop()
        msg = self.jc._comm.last_message
        self.assertIsNotNone(msg)
        self.assertTrue(self.jc._running_lookup_loop)
        self.assertIsNotNone(self.jc._lookup_timer)

        self.jc.stop_job_status_loop()
        self.assertFalse(self.jc._running_lookup_loop)
        self.assertIsNone(self.jc._lookup_timer)

    # ---------------------
    # Lookup all job states
    # ---------------------
    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_lookup_all_job_states_ok(self):
        req = make_comm_msg("all_status", None, True)
        states = self.jc._lookup_all_job_states(req)
        msg = self.jc._comm.last_message
        self.assertEqual(states, msg["data"]["content"])
        self.assertEqual("job_status_all", msg["data"]["msg_type"])
        self.assertIsInstance(states, dict)
        self.assertEqual(set(states.keys()), set(ALL_JOBS))
        for job_id in states:
            self.assertIsInstance(job_id, str)
            validate_job_state(states[job_id])

    # -----------------------
    # Lookup single job state
    # -----------------------
    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_lookup_job_state_direct_ok(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg("job_state", job_id, True)
        state = self.jc._lookup_job_state(req)
        msg = self.jc._comm.last_message
        self.assertEqual(state, msg["data"]["content"])
        self.assertEqual("job_status", msg["data"]["msg_type"])
        validate_job_state(state)

    def test_lookup_job_state_no_job(self):
        job_id = None
        req = make_comm_msg("job_state", job_id, True)

        with self.assertRaises(ValueError) as e:
            self.jc._lookup_job_state(req)
        self.assertIn("Job id required to process job_state request", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"job_id": None, "source": "job_state"}, msg["data"]["content"]
        )
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])

    def test_lookup_job_state_bad_job(self):
        job_id = "nope"
        req = make_comm_msg("job_state", job_id, True)
        with self.assertRaises(ValueError) as e:
            self.jc._lookup_job_state(req)
        self.assertIn(f"No job present with id {job_id}", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"state": {"job_id": job_id, "status": "does_not_exist"}},
            msg["data"]["content"],
        )
        self.assertEqual("job_status", msg["data"]["msg_type"])

    # ---------------
    # Lookup job info
    # ---------------
    def test_lookup_job_info_ok(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg("job_info", job_id, True)
        job_info = self.jc._lookup_job_info(req)
        expected = {
            "app_id": "NarrativeTest/test_editor",
            "app_name": "Test Editor",
            "job_id": job_id,
            "job_params": [
                {
                    "k_list": [],
                    "k_max": None,
                    "output_contigset_name": "MEGAHIT.contigs",
                }
            ],
        }
        for k in expected:
            self.assertIn(k, job_info)
            self.assertEqual(expected[k], job_info[k])

    def test_lookup_job_info_no_job(self):
        req = make_comm_msg("job_info", None, True)
        with self.assertRaises(ValueError) as e:
            self.jc._lookup_job_info(req)
        self.assertIn("Job id required to process job_info request", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual({"job_id": None, "source": "job_info"}, msg["data"]["content"])
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])

    def test_lookup_job_info_bad_job(self):
        job_id = "nope"
        req = make_comm_msg("job_info", job_id, True)
        with self.assertRaises(ValueError) as e:
            self.jc._lookup_job_info(req)
        self.assertIn(f"No job present with id {job_id}", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"job_id": job_id, "source": "job_info"}, msg["data"]["content"]
        )
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])

    # ------------
    # Cancel a job
    # ------------
    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_cancel_job_ok(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg("cancel_job", job_id, True)
        self.jc._cancel_job(req)
        msg = self.jc._comm.last_message
        self.assertEqual("job_status", msg["data"]["msg_type"])

    def test_cancel_job_no_job(self):
        req = make_comm_msg("cancel_job", None, True)
        with self.assertRaises(ValueError) as e:
            self.jc._cancel_job(req)
        self.assertIn("Job id required to process cancel_job request", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"job_id": None, "source": "cancel_job"}, msg["data"]["content"]
        )
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])

    def test_cancel_job_bad_job(self):
        job_id = "nope"
        req = make_comm_msg("cancel_job", job_id, True)
        with self.assertRaises(ValueError) as e:
            self.jc._cancel_job(req)
        self.assertIn(f"No job present with id {job_id}", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"job_id": job_id, "source": "cancel_job"}, msg["data"]["content"]
        )
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get",
        get_failing_mock_client,
    )
    def test_cancel_job_failure(self):
        job_id = JOB_CREATED
        req = make_comm_msg("cancel_job", job_id, True)
        with self.assertRaises(NarrativeException) as e:
            self.jc._cancel_job(req)
        self.assertIn("Can't cancel job", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual("job_comm_error", msg["data"]["msg_type"])
        self.assertEqual("Unable to cancel job", msg["data"]["content"]["error"])

    # ------------
    # Retry list of jobs
    # ------------
    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_retry_jobs_ok(self):
        job_id_list = ["5d64935cb215ad4128de94d9", None]
        req = make_comm_msg("retry_job", job_id_list, True)
        self.jc._retry_jobs(req)
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"job_id_list": ["9d49ed8214da512bc53946d5"]}, msg["data"]["content"]
        )
        self.assertEqual("new_job", msg["data"]["msg_type"])

    def test_retry_jobs_no_job(self):
        job_id_list = [None, ""]
        req = make_comm_msg("retry_job", job_id_list, True)
        with self.assertRaises(ValueError) as e:
            self.jc._retry_jobs(req)
        self.assertIn("No valid job ids", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"job_id_list": [], "source": "retry_job"}, msg["data"]["content"]
        )
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])

    def test_retry_jobs_bad_job(self):
        job_id_list = ["5d64935cb215ad4128de94d9", "nope", "no"]
        req = make_comm_msg("retry_job", job_id_list, True)
        with self.assertRaises(JobException) as e:
            self.jc._retry_jobs(req)
        self.assertIn(f"No jobs present with ids: {job_id_list[1:]}", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])
        self.assertEqual(
            {"job_id_list": job_id_list[1:], "source": "retry_job"},
            msg["data"]["content"],
        )

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get",
        get_failing_mock_client,
    )
    def test_retry_jobs_failure(self):
        job_id_list = [JOB_COMPLETED]
        req = make_comm_msg("retry_job", job_id_list, True)
        with self.assertRaises(NarrativeException) as e:
            self.jc._retry_jobs(req)
        self.assertIn("Jobs retry failed", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual("job_comm_error", msg["data"]["msg_type"])
        self.assertEqual(job_id_list, msg["data"]["content"]["job_id_list"])
        self.assertEqual("Unable to retry job(s)", msg["data"]["content"]["error"])

    # -----------------
    # Fetching job logs
    # -----------------
    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_get_job_logs_ok(self):
        job_id = JOB_COMPLETED
        lines_available = 100  # just for convenience if the mock changes
        # first_line, num_lines, latest, number of lines in output
        cases = [
            (0, 10, False, 10),
            (-100, 10, False, 10),
            (50, 20, False, 20),
            (0, 5000, False, lines_available),
            (0, None, False, lines_available),
            (80, None, False, 20),
            (0, 10, True, 10),
            (-100, 10, True, 10),
            (50, 20, True, 20),
            (0, 5000, True, lines_available),
            (0, None, True, lines_available),
            (80, None, True, lines_available),
        ]
        for c in cases:
            content = {"first_line": c[0], "num_lines": c[1], "latest": c[2]}
            req = make_comm_msg("job_logs", job_id, True, content)
            self.jc._get_job_logs(req)
            msg = self.jc._comm.last_message
            self.assertEqual("job_logs", msg["data"]["msg_type"])
            self.assertEqual(lines_available, msg["data"]["content"]["max_lines"])
            self.assertEqual(c[3], len(msg["data"]["content"]["lines"]))
            self.assertEqual(job_id, msg["data"]["content"]["job_id"])
            self.assertEqual(c[2], msg["data"]["content"]["latest"])
            first = 0 if c[1] is None and c[2] is True else c[0]
            n_lines = c[1] if c[1] else lines_available
            if first < 0:
                first = 0
            if c[2]:
                first = lines_available - min(n_lines, lines_available)

            self.assertEqual(first, msg["data"]["content"]["first"])
            for idx, line in enumerate(msg["data"]["content"]["lines"]):
                self.assertIn(str(first + idx), line["line"])
                self.assertEqual(0, line["is_error"])

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get",
        get_failing_mock_client,
    )
    def test_get_job_logs_failure(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg("job_logs", job_id, True)
        with self.assertRaises(NarrativeException) as e:
            self.jc._get_job_logs(req)
        self.assertIn("Can't get job logs", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual("job_comm_error", msg["data"]["msg_type"])
        self.assertEqual("Unable to retrieve job logs", msg["data"]["content"]["error"])

    def test_get_job_logs_no_job(self):
        job_id = None
        req = make_comm_msg("job_logs", job_id, True)
        with self.assertRaises(ValueError) as e:
            self.jc._get_job_logs(req)
        self.assertIn("Job id required to process job_logs request", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"job_id": job_id, "source": "job_logs"}, msg["data"]["content"]
        )
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])

    def test_get_job_logs_bad_job(self):
        job_id = "bad_job"
        req = make_comm_msg("job_logs", job_id, True)
        with self.assertRaises(ValueError) as e:
            self.jc._get_job_logs(req)
        self.assertIn(f"No job present with id {job_id}", str(e.exception))
        msg = self.jc._comm.last_message
        self.assertEqual(
            {"job_id": job_id, "source": "job_logs"}, msg["data"]["content"]
        )
        self.assertEqual("job_does_not_exist", msg["data"]["msg_type"])

    # ------------------------
    # Handle bad comm messages
    # ------------------------
    def test_handle_comm_message_bad(self):
        with self.assertRaises(ValueError) as e:
            self.jc._handle_comm_message({"foo": "bar"})
        self.assertIn("Improperly formatted job channel message!", str(e.exception))
        with self.assertRaises(ValueError) as e:
            self.jc._handle_comm_message({"content": {"data": {"request_type": None}}})
        self.assertIn("Missing request type in job channel message!", str(e.exception))

    def test_handle_comm_message_unknown(self):
        unknown = "NotAJobRequest"
        with self.assertRaises(ValueError) as e:
            self.jc._handle_comm_message(
                {"content": {"data": {"request_type": unknown}}}
            )
        self.assertIn(f"Unknown KBaseJobs message '{unknown}'", str(e.exception))

    # From here, this test the ability for the _handle_comm_message function to
    # deal with the various types of messages that will get passed to it. While
    # the majority of the tests above are sent directly to the function to be
    # tested, these just craft the message and pass it to the message handler.
    def test_handle_all_states_msg(self):
        req = make_comm_msg("all_status", None, False)
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertEqual(msg["data"]["msg_type"], "job_status_all")
        states = msg["data"]["content"]
        self.assertIsInstance(states, dict)
        for job_id in states:
            print("ALL JOB STATE TESTING")
            print(states[job_id])
            validate_job_state(states[job_id])

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_handle_job_status_msg(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg("job_status", job_id, False)
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertEqual(msg["data"]["msg_type"], "job_status")
        validate_job_state(msg["data"]["content"])

    def test_handle_job_info_msg(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg("job_info", job_id, False)
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertEqual(msg["data"]["msg_type"], "job_info")

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_handle_cancel_job_msg(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg("cancel_job", job_id, False)
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertEqual(msg["data"]["msg_type"], "job_status")

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_handle_start_job_update_msg(self):
        job_id = JOB_COMPLETED
        refresh_count = self.jm._running_jobs[job_id]["refresh"]
        req = make_comm_msg("start_job_update", job_id, False)
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertEqual(msg["data"]["msg_type"], "job_status_all")
        self.assertEqual(self.jm._running_jobs[job_id]["refresh"], refresh_count + 1)
        self.assertTrue(self.jc._running_lookup_loop)
        self.jc.stop_job_status_loop()

    def test_handle_stop_job_update_msg(self):
        job_id = JOB_COMPLETED
        refresh_count = self.jm._running_jobs[job_id]["refresh"]
        req = make_comm_msg("stop_job_update", job_id, False)
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertIsNone(msg)
        self.assertEqual(
            self.jm._running_jobs[job_id]["refresh"], max(refresh_count - 1, 0)
        )

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_handle_latest_job_logs_msg(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg(
            "job_logs", job_id, False, content={"num_lines": 10, "latest": True}
        )
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertEqual(msg["data"]["msg_type"], "job_logs")
        self.assertEqual(msg["data"]["content"]["job_id"], job_id)
        self.assertTrue(msg["data"]["content"]["latest"])
        self.assertEqual(msg["data"]["content"]["first"], 90)
        self.assertEqual(msg["data"]["content"]["max_lines"], 100)
        self.assertEqual(len(msg["data"]["content"]["lines"]), 10)

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_handle_job_logs_msg(self):
        job_id = JOB_COMPLETED
        req = make_comm_msg(
            "job_logs", job_id, False, content={"num_lines": 10, "first_line": 0}
        )
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertEqual(msg["data"]["msg_type"], "job_logs")
        self.assertEqual(msg["data"]["content"]["job_id"], job_id)
        self.assertFalse(msg["data"]["content"]["latest"])
        self.assertEqual(msg["data"]["content"]["first"], 0)
        self.assertEqual(msg["data"]["content"]["max_lines"], 100)
        self.assertEqual(len(msg["data"]["content"]["lines"]), 10)

    @mock.patch(
        "biokbase.narrative.jobs.jobcomm.jobmanager.clients.get", get_mock_client
    )
    def test_handle_cancel_job_msg_with_job_id_list(self):
        job_id_list = [JOB_COMPLETED]
        req = make_comm_msg("cancel_job", job_id_list, False)
        self.jc._handle_comm_message(req)
        msg = self.jc._comm.last_message
        self.assertEqual(msg["data"]["msg_type"], "job_status")


class JobRequestTestCase(unittest.TestCase):
    """
    Test the JobRequest module.
    This makes sure that it knows what to do with ok requests, bad requests,
    etc.
    """

    def test_request_ok(self):
        rq_msg = {
            "msg_id": "some_id",
            "content": {"data": {"request_type": "a_request"}},
        }
        rq = JobRequest(rq_msg)
        self.assertEqual(rq.msg_id, "some_id")
        self.assertEqual(rq.request, "a_request")
        self.assertIsNone(rq.job_id)

    def test_request_no_data(self):
        rq_msg = {"msg_id": "some_id", "content": {}}
        with self.assertRaises(ValueError) as e:
            JobRequest(rq_msg)
        self.assertIn("Improperly formatted job channel message!", str(e.exception))

    def test_request_no_req(self):
        rq_msg = {"msg_id": "some_id", "content": {"data": {"request_type": None}}}
        rq_msg2 = {"msg_id": "some_other_id", "content": {"data": {}}}
        for msg in [rq_msg, rq_msg2]:
            with self.assertRaises(ValueError) as e:
                JobRequest(msg)
            self.assertIn(
                "Missing request type in job channel message!", str(e.exception)
            )

    def _check_rq_equal(self, rq0, rq1):
        self.assertEqual(rq0.msg_id, rq1.msg_id)
        self.assertEqual(rq0.rq_data, rq1.rq_data)
        self.assertEqual(rq0.request, rq1.request)
        self.assertEqual(rq0.job_id, rq1.job_id)

    def test_convert_to_using_job_id_list(self):
        rq_msg = make_comm_msg("a_request", "a", False)
        rq = JobRequest._convert_to_using_job_id_list(rq_msg)
        self.assertEqual(rq.request, "a_request")
        self.assertEqual(rq.job_id, None)
        self.assertEqual(rq.job_id_list, ["a"])

    def test_split_request_by_job_id(self):
        rq_msg = make_comm_msg("a_request", ["a", "b", "c"], False)
        rqa0 = make_comm_msg("a_request", "a", True)
        rqb0 = make_comm_msg("a_request", "b", True)
        rqc0 = make_comm_msg("a_request", "c", True)
        rqa1, rqb1, rqc1 = JobRequest._split_request_by_job_id(rq_msg)
        self._check_rq_equal(rqa0, rqa1)
        self._check_rq_equal(rqb0, rqb1)
        self._check_rq_equal(rqc0, rqc1)

    def test_translate_require_job_id(self):
        rq_msg = make_comm_msg("job_info", "a", False)
        rqs = JobRequest.translate(rq_msg)
        self.assertEqual(len(rqs), 1)
        self.assertEqual(rqs[0].job_id, "a")
        self.assertEqual(rqs[0].job_id_list, None)

        rq_msg = make_comm_msg("job_info", ["a", "b"], False)
        rqs = JobRequest.translate(rq_msg)
        self.assertEqual(len(rqs), 2)
        self.assertEqual(rqs[0].job_id, "a")
        self.assertEqual(rqs[0].job_id_list, None)
        self.assertEqual(rqs[1].job_id, "b")
        self.assertEqual(rqs[1].job_id_list, None)

    def test_translate_require_job_id_list(self):
        rq_msg = make_comm_msg("retry_job", "a", False)
        rqs = JobRequest.translate(rq_msg)
        self.assertEqual(len(rqs), 1)
        self.assertEqual(rqs[0].job_id, None)
        self.assertEqual(rqs[0].job_id_list, ["a"])

        rq_msg = make_comm_msg("retry_job", ["a", "b"], False)
        rqs = JobRequest.translate(rq_msg)
        self.assertEqual(len(rqs), 1)
        self.assertEqual(rqs[0].job_id, None)
        self.assertEqual(rqs[0].job_id_list, ["a", "b"])

    def test_translate_doesnt_require_any_job_ids(self):
        rq_msg = make_comm_msg("all_status", None, False)
        rqs = JobRequest.translate(rq_msg)
        self.assertEqual(len(rqs), 1)
