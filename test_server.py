import json
import os
import unittest
from unittest.mock import patch

import server


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.request_data = {
            "artwork": {"title": "Annunciazione", "artist": "Beato Angelico"},
            "selection": {"type": "hotspot", "hotspotId": "angelo-gabriele"},
            "hotspot": {"title": "L’angelo Gabriele"},
            "sources": [{"title": "Museo", "url": "https://example.org", "type": "Museo"}],
            "learningLevel": "Scuola secondaria",
        }

    def test_get_openrouter_api_key_accepts_supported_names(self):
        self.assertEqual(server.get_openrouter_api_key({"OPENROUTER_API_KEY": " nim-key "}), "nim-key")
        self.assertEqual(server.get_openrouter_api_key({"OPENROUTER_API_KEY": "primary", "NGC_API_KEY": "fallback"}), "primary")
        self.assertEqual(server.get_openrouter_api_key({}), "")

    def test_clean_model_json_accepts_fenced_json(self):
        result = server.clean_model_json('```json\n{"observation":"Volto"}\n```')
        self.assertEqual(result["observation"], "Volto")

    def test_normalize_analysis_preserves_structured_content(self):
        result = server.normalize_analysis({
            "observation": "Un angelo inginocchiato.",
            "importance": "Rende visibile l’annuncio.",
            "composition": "Equilibra Maria.",
            "curiosity": "Dettaglio curioso.",
            "connection": "Rinascimento.",
            "confidence": {"level": "high", "label": "Osservazione verificata"},
        }, self.request_data)
        self.assertEqual(result["title"], "L’angelo Gabriele")
        self.assertEqual(result["content"]["observation"], "Un angelo inginocchiato.")
        self.assertEqual(result["confidence"]["level"], "high")
        self.assertEqual(len(result["sources"]), 1)

    def test_call_openrouter_requires_server_side_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "OPENROUTER_API_KEY"):
                server.call_openrouter(self.request_data)

    @patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"})
    @patch("server.urlopen")
    def test_call_openrouter_maps_openai_compatible_response(self, mocked_urlopen):
        mocked_urlopen.return_value = FakeResponse({
            "choices": [{"message": {"content": json.dumps({
                "observation": "Un angelo.",
                "importance": "È il messaggero.",
                "composition": "Bilancia la scena.",
                "curiosity": "Una curiosità.",
                "connection": "Un collegamento.",
                "confidence": {"level": "high", "label": "Ben supportata"},
            })}}]
        })
        with patch.object(server, "image_data_uri", return_value="data:image/jpeg;base64,AA=="):
            result = server.call_openrouter(self.request_data)
        self.assertEqual(result["content"]["observation"], "Un angelo.")
        request = mocked_urlopen.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual(body["model"], server.TEXT_MODEL)
        self.assertEqual(body["messages"][0]["content"][0]["type"], "text")
        self.assertEqual(request.headers["Authorization"], "Bearer test-key")


if __name__ == "__main__":
    unittest.main()
