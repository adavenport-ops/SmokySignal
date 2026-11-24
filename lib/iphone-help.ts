// The iPhone setup page (/help/iphone, B22). Pure and client-safe: the
// install card, the radar's location-blocked toast and the speed-warning
// settings link here, so the paths live in one place.
//
// Section anchors are the rehype-slug ids of the headings in
// content/help-iphone.md; lib/iphone-help.test.ts pins them to the file.

export const IPHONE_HELP_PATH = "/help/iphone";

export const IPHONE_HELP_ANCHORS = {
  homeScreen: "1-add-it-to-the-home-screen",
  location: "2-turn-on-location",
  notifications: "3-allow-notifications",
  voice: "4-voice-readback",
} as const;

export const IPHONE_LOCATION_HREF = `${IPHONE_HELP_PATH}#${IPHONE_HELP_ANCHORS.location}`;

export const IPHONE_HELP_TITLE = "iPhone setup: home screen, location and alerts";

export const IPHONE_HELP_DESCRIPTION =
  "Set up SmokySignal on iPhone in three steps: add it to the home screen, turn on location for Safari websites, then allow notifications. Plus voice readback.";
