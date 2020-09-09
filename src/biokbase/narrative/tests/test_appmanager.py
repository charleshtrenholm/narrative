"""
Tests for the app manager.
"""
from biokbase.narrative.jobs.appmanager import AppManager
import biokbase.narrative.jobs.specmanager as specmanager
import biokbase.narrative.app_util as app_util
from biokbase.narrative.jobs.job import Job
from IPython.display import HTML
import unittest
import mock
from .narrative_mock.mockclients import get_mock_client
import os
from .util import TestConfig


def mock_agent_token(*args, **kwargs):
    return dict({"user": "testuser", "id": "12345", "token": "abcde"})


def mock_run_job(*args, **kwargs):
    return "new_job_id"


class AppManagerTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config = TestConfig()
        cls.am = AppManager()
        cls.good_app_id = config.get("app_tests", "good_app_id")
        cls.good_tag = config.get("app_tests", "good_app_tag")
        cls.bad_app_id = config.get("app_tests", "bad_app_id")
        cls.bad_tag = config.get("app_tests", "bad_app_tag")
        cls.test_app_id = config.get("app_tests", "test_app_id")
        cls.test_app_params = {
            "read_library_names": ["rhodo.art.jgi.reads"],
            "output_contigset_name": "rhodo_contigs",
            "recipe": "auto",
            "assembler": "",
            "pipeline": "",
            "min_contig_len": None,
        }
        cls.test_job_id = config.get("app_tests", "test_job_id")
        cls.test_tag = config.get("app_tests", "test_app_tag")
        cls.public_ws = config.get("app_tests", "public_ws_name")
        cls.ws_id = int(config.get("app_tests", "public_ws_id"))
        cls.app_input_ref = config.get("app_tests", "test_input_ref")
        cls.batch_app_id = config.get("app_tests", "batch_app_id")

    def test_reload(self):
        self.am.reload()
        info = self.am.app_usage(self.good_app_id, self.good_tag)
        self.assertTrue(info)

    def test_app_usage(self):
        # good id and good tag
        usage = self.am.app_usage(self.good_app_id, self.good_tag)
        self.assertTrue(usage)

        # bad id
        with self.assertRaises(ValueError):
            self.am.app_usage(self.bad_app_id)

        # bad tag
        with self.assertRaises(ValueError):
            self.am.app_usage(self.good_app_id, self.bad_tag)

    def test_app_usage_html(self):
        usage = self.am.app_usage(self.good_app_id, self.good_tag)
        self.assertTrue(usage._repr_html_())

    def test_app_usage_str(self):
        usage = self.am.app_usage(self.good_app_id, self.good_tag)
        self.assertTrue(str(usage))

    def test_available_apps_good(self):
        apps = self.am.available_apps(self.good_tag)
        self.assertIsInstance(apps, HTML)

    def test_available_apps_bad(self):
        with self.assertRaises(ValueError):
            self.am.available_apps(self.bad_tag)

    @mock.patch("biokbase.narrative.jobs.appmanager.clients.get", get_mock_client)
    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    @mock.patch(
        "biokbase.narrative.jobs.appmanager.auth.get_agent_token",
        side_effect=mock_agent_token,
    )
    def test_dry_run_app(self, c, auth):
        os.environ["KB_WORKSPACE_ID"] = self.public_ws
        output = self.am.run_app(
            self.test_app_id, self.test_app_params, tag=self.test_tag, dry_run=True
        )
        self.assertIsInstance(output, dict)
        self.assertEqual(output["app_id"], self.test_app_id)
        self.assertIsInstance(output["params"], list)
        self.assertIn("method", output)
        self.assertIn("service_ver", output)
        self.assertIn("meta", output)
        self.assertIn("tag", output["meta"])
        self.assertIn("wsid", output)

    @mock.patch("biokbase.narrative.jobs.appmanager.clients.get", get_mock_client)
    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    @mock.patch(
        "biokbase.narrative.jobs.appmanager.auth.get_agent_token",
        side_effect=mock_agent_token,
    )
    def test_run_app_good_inputs(self, c, auth):
        c.return_value.send_comm_message.return_value = None
        os.environ["KB_WORKSPACE_ID"] = self.public_ws
        new_job = self.am.run_app(
            self.test_app_id, self.test_app_params, tag=self.test_tag
        )
        self.assertIsInstance(new_job, Job)
        self.assertEqual(new_job.job_id, self.test_job_id)
        self.assertEqual(new_job.app_id, self.test_app_id)
        self.assertEqual(new_job.tag, self.test_tag)
        self.assertIsNone(new_job.cell_id)

    @mock.patch("biokbase.narrative.jobs.appmanager.clients.get", get_mock_client)
    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    @mock.patch(
        "biokbase.narrative.jobs.appmanager.auth.get_agent_token",
        side_effect=mock_agent_token,
    )
    def test_run_app_from_gui_cell(self, c, auth):
        c.return_value.send_comm_message.return_value = None
        os.environ["KB_WORKSPACE_ID"] = self.public_ws
        self.assertIsNone(
            self.am.run_app(
                self.test_app_id,
                self.test_app_params,
                tag=self.test_tag,
                cell_id="12345",
            )
        )

    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    def test_run_app_bad_id(self, c):
        c.return_value.send_comm_message.return_value = None
        self.assertIsNone(self.am.run_app(self.bad_app_id, None))

    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    def test_run_app_bad_tag(self, c):
        c.return_value.send_comm_message.return_value = None
        self.assertIsNone(self.am.run_app(self.good_app_id, None, tag=self.bad_tag))

    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    def test_run_app_bad_version_match(self, c):
        # fails because a non-release tag can't be versioned
        c.return_value.send_comm_message.return_value = None
        self.assertIsNone(
            self.am.run_app(self.good_app_id, None, tag=self.good_tag, version=">0.0.1")
        )

    # Running an app with missing inputs is now allowed. The app can
    # crash if it wants to, it can leave its process behind.
    @mock.patch("biokbase.narrative.jobs.appmanager.clients.get", get_mock_client)
    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    @mock.patch(
        "biokbase.narrative.jobs.appmanager.auth.get_agent_token",
        side_effect=mock_agent_token,
    )
    def test_run_app_missing_inputs(self, c, auth):
        c.return_value.send_comm_message.return_value = None
        self.assertIsNotNone(self.am.run_app(self.good_app_id, None, tag=self.good_tag))

    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    def test_run_app_bad_version(self, c):
        c.return_value.send_comm_message.return_value = None
        self.assertIsNone(
            self.am.run_app(self.good_app_id, None, tag="dev", version="1.0.0")
        )

    @mock.patch("biokbase.narrative.jobs.appmanager.clients.get", get_mock_client)
    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    @mock.patch(
        "biokbase.narrative.jobs.appmanager.auth.get_agent_token",
        side_effect=mock_agent_token,
    )
    def test_run_app_batch_good_inputs(self, c, auth):
        c.return_value.send_comm_message.return_value = None
        os.environ["KB_WORKSPACE_ID"] = self.public_ws
        new_job = self.am.run_app_batch(
            self.test_app_id,
            [self.test_app_params, self.test_app_params],
            tag=self.test_tag,
        )
        self.assertIsInstance(new_job, Job)
        self.assertEqual(new_job.job_id, self.test_job_id)
        self.assertEqual(new_job.app_id, self.batch_app_id)
        self.assertEqual(new_job.tag, self.test_tag)
        self.assertIsNone(new_job.cell_id)

    @mock.patch("biokbase.narrative.jobs.appmanager.clients.get", get_mock_client)
    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    @mock.patch(
        "biokbase.narrative.jobs.appmanager.auth.get_agent_token",
        side_effect=mock_agent_token,
    )
    def test_run_app_batch_gui_cell(self, c, auth):
        c.return_value.send_comm_message.return_value = None
        os.environ["KB_WORKSPACE_ID"] = self.public_ws
        self.assertIsNone(
            self.am.run_app_batch(
                self.test_app_id,
                [self.test_app_params, self.test_app_params],
                tag=self.test_tag,
                cell_id="12345",
            )
        )

    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    def test_run_app_batch_bad_id(self, c):
        c.return_value.send_comm_message.return_value = None
        self.assertIsNone(self.am.run_app_batch(self.bad_app_id, None))

    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    def test_run_app_batch_bad_tag(self, c):
        c.return_value.send_comm_message.return_value = None
        self.assertIsNone(
            self.am.run_app_batch(self.good_app_id, None, tag=self.bad_tag)
        )

    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    def test_run_app_batch_bad_version_match(self, c):
        # fails because a non-release tag can't be versioned
        c.return_value.send_comm_message.return_value = None
        self.assertIsNone(
            self.am.run_app_batch(
                self.good_app_id, None, tag=self.good_tag, version=">0.0.1"
            )
        )

    # Running an app with missing inputs is now allowed. The app can
    # crash if it wants to, it can leave its process behind.
    @mock.patch("biokbase.narrative.jobs.appmanager.clients.get", get_mock_client)
    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    @mock.patch(
        "biokbase.narrative.jobs.appmanager.auth.get_agent_token",
        side_effect=mock_agent_token,
    )
    def test_run_app_missing_inputs(self, c, auth):
        c.return_value.send_comm_message.return_value = None
        self.assertIsNotNone(
            self.am.run_app_batch(self.good_app_id, None, tag=self.good_tag)
        )

    @mock.patch("biokbase.narrative.jobs.appmanager.JobComm")
    def test_run_app_batch_bad_version(self, c):
        c.return_value.send_comm_message.return_value = None
        self.assertIsNone(
            self.am.run_app_batch(self.good_app_id, None, tag="dev", version="1.0.0")
        )

    @mock.patch(
        "biokbase.narrative.jobs.appmanager.specmanager.clients.get", get_mock_client
    )
    def test_app_description(self):
        desc = self.am.app_description(self.good_app_id, tag=self.good_tag)
        self.assertIsInstance(desc, HTML)

    @mock.patch(
        "biokbase.narrative.jobs.appmanager.specmanager.clients.get", get_mock_client
    )
    def test_app_description_bad_tag(self):
        with self.assertRaises(ValueError):
            self.am.app_description(self.good_app_id, tag=self.bad_tag)

    @mock.patch(
        "biokbase.narrative.jobs.appmanager.specmanager.clients.get", get_mock_client
    )
    def test_app_description_bad_name(self):
        with self.assertRaises(ValueError):
            self.am.app_description(self.bad_app_id)

    @mock.patch(
        "biokbase.narrative.jobs.appmanager.specmanager.clients.get", get_mock_client
    )
    @mock.patch("biokbase.narrative.jobs.specmanager.clients.get", get_mock_client)
    def test_validate_params(self):
        inputs = {
            "reads_tuple": [
                {
                    "input_reads_label": "reads file 1",
                    "input_reads_obj": "rhodobacterium.art.q20.int.PE.reads",
                    "input_reads_metadata": {"key1": "value1"},
                },
                {
                    "input_reads_label": "reads file 2",
                    "input_reads_obj": "rhodobacterium.art.q10.PE.reads",
                    "input_reads_metadata": {"key2": "value2"},
                },
            ],
            "output_object": "MyReadsSet",
            "description": "New Reads Set",
        }
        app_id = "NarrativeTest/test_create_set"
        tag = "dev"
        prev_ws_id = os.environ.get("KB_WORKSPACE_ID")
        os.environ["KB_WORKSPACE_ID"] = self.public_ws
        sm = specmanager.SpecManager()
        spec = sm.get_spec(app_id, tag=tag)
        (params, ws_inputs) = app_util.validate_parameters(
            app_id, tag, sm.app_params(spec), inputs
        )
        self.assertDictEqual(params, inputs)
        self.assertIn("12345/8/1", ws_inputs)
        self.assertIn("12345/7/1", ws_inputs)
        if prev_ws_id is None:
            del os.environ["KB_WORKSPACE_ID"]
        else:
            os.environ["KB_WORKSPACE_ID"] = prev_ws_id

    @mock.patch(
        "biokbase.narrative.jobs.appmanager.specmanager.clients.get", get_mock_client
    )
    @mock.patch("biokbase.narrative.jobs.specmanager.clients.get", get_mock_client)
    @mock.patch("biokbase.narrative.clients.get", get_mock_client)
    def test_input_mapping(self):
        self.maxDiff = None
        inputs = {
            "reads_tuple": [
                {
                    "input_reads_label": "reads file 1",
                    "input_reads_obj": "rhodobacterium.art.q20.int.PE.reads",
                    "input_reads_metadata": {"key1": "value1"},
                },
                {
                    "input_reads_label": "reads file 2",
                    "input_reads_obj": "rhodobacterium.art.q10.PE.reads",
                    "input_reads_metadata": {"key2": "value2"},
                },
            ],
            "output_object": "MyReadsSet",
            "description": "New Reads Set",
        }
        app_id = "NarrativeTest/test_create_set"
        tag = "dev"
        ws_name = self.public_ws
        prev_ws_id = os.environ.get("KB_WORKSPACE_ID", None)
        os.environ["KB_WORKSPACE_ID"] = ws_name
        sm = specmanager.SpecManager()
        spec = sm.get_spec(app_id, tag=tag)
        spec_params = sm.app_params(spec)
        spec_params_map = dict(
            (spec_params[i]["id"], spec_params[i]) for i in range(len(spec_params))
        )
        mapped_inputs = self.am._map_inputs(
            spec["behavior"]["kb_service_input_mapping"], inputs, spec_params_map
        )
        expected = [
            {
                "output_object_name": "MyReadsSet",
                "data": {
                    "items": [
                        {
                            "label": "reads file 1",
                            "metadata": {"key1": "value1"},
                            "ref": "12345/7/1",
                        },
                        {
                            "label": "reads file 2",
                            "metadata": {"key2": "value2"},
                            "ref": "12345/8/1",
                        },
                    ],
                    "description": "New Reads Set",
                },
                "workspace": ws_name,
            }
        ]
        self.assertDictEqual(expected[0], mapped_inputs[0])
        ref_path = (
            ws_name + "/MyReadsSet; " + ws_name + "/rhodobacterium.art.q10.PE.reads"
        )
        ret = app_util.transform_param_value("resolved-ref", ref_path, None)
        self.assertEqual(ret, ws_name + "/MyReadsSet;18836/5/1")
        if prev_ws_id is None:
            del os.environ["KB_WORKSPACE_ID"]
        else:
            os.environ["KB_WORKSPACE_ID"] = prev_ws_id

    @mock.patch(
        "biokbase.narrative.jobs.appmanager.specmanager.clients.get", get_mock_client
    )
    def test_generate_input(self):
        prefix = "pre"
        suffix = "suf"
        num_symbols = 8
        generator = {"symbols": num_symbols, "prefix": prefix, "suffix": suffix}
        rand_str = self.am._generate_input(generator)
        self.assertTrue(rand_str.startswith(prefix))
        self.assertTrue(rand_str.endswith(suffix))
        self.assertEqual(len(rand_str), len(prefix) + len(suffix) + num_symbols)

    def test_generate_input_bad(self):
        with self.assertRaises(ValueError):
            self.am._generate_input({"symbols": "foo"})
        with self.assertRaises(ValueError):
            self.am._generate_input({"symbols": -1})

    def test_transform_input_good(self):
        ws_name = self.public_ws
        os.environ["KB_WORKSPACE_ID"] = ws_name
        test_data = [
            {
                "value": "input_value",
                "type": "ref",
                "expected": ws_name + "/" + "input_value",
            },
            {
                "value": ws_name + "/input_value",
                "type": "ref",
                "expected": ws_name + "/" + "input_value",
            },
            {
                "value": "input_value",
                "type": "unresolved-ref",
                "expected": ws_name + "/" + "input_value",
            },
            {
                "value": "rhodobacterium.art.q20.int.PE.reads",
                "type": "resolved-ref",
                "expected": "11635/9/1",
            },
            {
                "value": ws_name + "/rhodobacterium.art.q20.int.PE.reads",
                "type": "resolved-ref",
                "expected": "11635/9/1",
            },
            {"value": None, "type": "int", "expected": None},
            {"value": "5", "type": "int", "expected": 5},
            {
                "value": ["a", "b", "c"],
                "type": "list<ref>",
                "expected": [ws_name + "/a", ws_name + "/b", ws_name + "/c"],
            },
            {
                "value": [
                    "rhodobacterium.art.q20.int.PE.reads",
                    "rhodobacterium.art.q10.PE.reads",
                ],
                "type": "list<resolved-ref>",
                "expected": ["11635/9/1", "11635/10/1"],
            },
            {"value": "foo", "type": "list<ref>", "expected": [ws_name + "/foo"]},
            {"value": ["1", "2", 3], "type": "list<int>", "expected": [1, 2, 3]},
            {"value": "bar", "type": None, "expected": "bar"},
            {
                "value": "rhodobacterium.art.q20.int.PE.reads",
                "type": "future-default",
                "spec": {"is_output": 0, "allowed_types": ["Some.KnownType"]},
                "expected": "11635/9/1",
            },
            {"value": [123, 456], "type": None, "expected": [123, 456]},
            {"value": 123, "type": "string", "expected": "123"},
            {
                "value": ["one", "two"],
                "type": None,
                "spec": {"type": "textsubdata"},
                "expected": "one,two",
            },
            {
                "value": ["one", "two"],
                "type": "list<string>",
                "spec": {"type": "textsubdata"},
                "expected": ["one", "two"],
            },
            {"value": {"one": 1}, "type": "string", "expected": "one=1"},
        ]
        for test in test_data:
            spec = test.get("spec", None)
            ret = app_util.transform_param_value(test["type"], test["value"], spec)
            self.assertEqual(ret, test["expected"])
        del os.environ["KB_WORKSPACE_ID"]

    def test_transform_input_bad(self):
        with self.assertRaises(ValueError):
            app_util.transform_param_value("foo", "bar", None)


if __name__ == "__main__":
    unittest.main()
