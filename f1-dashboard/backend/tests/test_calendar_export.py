import unittest
from datetime import datetime, timezone

from calendar_export import (
    DEFAULT_PUBLIC_SITE_URL,
    build_calendar_ics,
    escape_ics_text,
    fold_ics_line,
    validate_calendar_request,
)


class CalendarExportTests(unittest.TestCase):
    def setUp(self):
        self.generated_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        self.events = [
            {
                "round": 1,
                "name": "Australian Grand Prix",
                "location": "Melbourne",
                "country": "Australia",
                "sessions": {
                    "Practice 1": "2026-03-06T12:30:00+11:00",
                    "Race": "2026-03-08T15:00:00+11:00",
                    "Invalid": "not-a-date",
                    "Naive": "2026-03-08T15:00:00",
                },
            }
        ]

    def test_text_escaping_normalizes_every_newline_form(self):
        self.assertEqual(
            escape_ics_text("one\r\ntwo\rthree\nfour\\;,"),
            r"one\ntwo\nthree\nfour\\\;\,",
        )

    def test_utf8_folding_obeys_75_octet_limit_and_unfolds_losslessly(self):
        original = "SUMMARY:" + ("🏁é" * 30) + " end"
        folded = fold_ics_line(original)
        physical_lines = folded.split("\r\n")
        self.assertGreater(len(physical_lines), 1)
        self.assertTrue(all(len(line.encode("utf-8")) <= 75 for line in physical_lines))
        self.assertTrue(all(line.startswith(" ") for line in physical_lines[1:]))
        self.assertEqual(folded.replace("\r\n ", ""), original)

    def test_build_converts_offsets_omits_invalid_times_and_describes_estimates(self):
        ics = build_calendar_ics(
            self.events,
            2026,
            generated_at=self.generated_at,
            public_site_url="https://calendar.example/app/",
        )
        self.assertIsNotNone(ics)
        assert ics is not None
        self.assertIn("DTSTART:20260306T013000Z", ics)
        self.assertIn("DTSTART:20260308T040000Z", ics)
        self.assertEqual(ics.count("BEGIN:VEVENT"), 2)
        unfolded = ics.replace("\r\n ", "")
        self.assertIn(r"Estimated duration: 60 minutes\; calendar end time is approximate.", unfolded)
        self.assertIn(r"Estimated duration: 120 minutes\; calendar end time is approximate.", unfolded)
        self.assertIn("URL:https://calendar.example/app/live", ics)
        self.assertIn("TRIGGER:-PT30M", ics)
        self.assertTrue(ics.endswith("\r\n"))
        self.assertNotIn("\n", ics.replace("\r\n", ""))

    def test_uid_is_stable_for_year_round_and_session(self):
        first = build_calendar_ics(
            self.events, 2026, generated_at=self.generated_at
        )
        second = build_calendar_ics(
            self.events,
            2026,
            generated_at=datetime(2026, 2, 2, tzinfo=timezone.utc),
        )
        assert first is not None and second is not None
        first_uids = [line for line in first.split("\r\n") if line.startswith("UID:")]
        second_uids = [line for line in second.split("\r\n") if line.startswith("UID:")]
        self.assertEqual(first_uids, second_uids)
        self.assertEqual(len(first_uids), 2)
        self.assertEqual(len(set(first_uids)), 2)

    def test_localhost_public_url_falls_back_to_deployed_site(self):
        ics = build_calendar_ics(
            self.events,
            2026,
            generated_at=self.generated_at,
            public_site_url="http://localhost:3000",
        )
        assert ics is not None
        self.assertIn(f"URL:{DEFAULT_PUBLIC_SITE_URL}/live", ics)
        self.assertNotIn("localhost", ics)

    def test_empty_or_unknown_round_has_no_calendar_file(self):
        self.assertIsNone(
            build_calendar_ics(
                self.events, 2026, round_num=2, generated_at=self.generated_at
            )
        )
        self.assertIsNone(build_calendar_ics([], 2026, generated_at=self.generated_at))

    def test_request_ranges_are_validated(self):
        validate_calendar_request(1950, 1)
        validate_calendar_request(2100, 30)
        for year in (1949, 2101):
            with self.assertRaises(ValueError):
                validate_calendar_request(year)
        for round_num in (0, 31):
            with self.assertRaises(ValueError):
                validate_calendar_request(2026, round_num)


if __name__ == "__main__":
    unittest.main()
