// FAQ content for FAQPage structured data. Nothing here is new copy:
//
//   - PROGRAM_FAQ answers are sentences lifted verbatim from the visible
//     /program page (lib/seo/faq.test.ts fails if one stops appearing
//     there). Questions name what each section already answers.
//   - helpFaq() parses content/help.md: question-shaped headings take the
//     section's first paragraph, and the "When something looks wrong"
//     bullets are already problem / answer pairs.

export type FaqEntry = { question: string; answer: string };

export const PROGRAM_FAQ: readonly FaqEntry[] = [
  {
    question: "Who flies aircraft over Puget Sound?",
    answer:
      "Most of the traffic over Puget Sound is WSP out of Olympia and the King County Sheriff out of Renton. Oregon and Idaho units count only once they cross into Washington.",
  },
  {
    question: "What aircraft does the Washington State Patrol fly?",
    answer:
      "WSP said in 2023 that its Aviation Section runs five Cessnas and one King Air from a hangar at Olympia. The FAA registry now lists six Cessnas under WSP, two of them new since 2025.",
  },
  {
    question: "What does a FLIR camera do?",
    answer:
      "FLIR stands for forward-looking infrared. It's a heat camera on a stabilized gimbal under the wing or nose. It sees warm things (engines, tires, people) against cooler ground, day or night, and zooms far enough to follow one vehicle from a few thousand feet. Crews also use it for searches and rescues.",
  },
  {
    question: "How does aerial speed enforcement work in Washington?",
    answer:
      "Some Washington highways have white marks painted on the shoulder at measured intervals. Reporting describes half-mile courses. The crew times a vehicle between marks with a calibrated stopwatch; distance over time gives its average speed.",
  },
  {
    question: "Does the aircraft make the traffic stop?",
    answer:
      "The bird doesn't pull anyone over. The crew radios the time, a description of the vehicle, and what they saw to a trooper on the ground. The trooper makes the stop.",
  },
  {
    question: "How does SmokySignal know where the aircraft are?",
    answer:
      "Most aircraft broadcast their position, altitude, and speed about once a second over a radio system called ADS-B. It's unencrypted on purpose, so other pilots and air traffic control can hear it. Anyone with a cheap antenna can receive it, and doing so is legal.",
  },
  {
    question: "Is SmokySignal affiliated with WSP?",
    answer:
      "SmokySignal is a hobby project run by a private individual. Not affiliated with WSP or any other agency. No ads, no accounts.",
  },
];

/** Markdown inline → plain text: links keep their label, emphasis and code marks drop. */
export function stripInlineMarkdown(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

type MdSection = { heading: string; level: number; body: string[] };

function sections(md: string): MdSection[] {
  const out: MdSection[] = [];
  let cur: MdSection | null = null;
  let fence = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    const h = !fence ? /^(#{1,6})\s+(.+?)\s*$/.exec(line) : null;
    if (h) {
      cur = { heading: h[2]!, level: h[1]!.length, body: [] };
      out.push(cur);
    } else if (cur) {
      cur.body.push(line);
    }
  }
  return out;
}

function firstParagraph(lines: readonly string[]): string | null {
  const para: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (para.length > 0) break;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s/.test(line) || line.startsWith("|")) {
      if (para.length > 0) break;
      return null;
    }
    para.push(line.trim());
  }
  return para.length > 0 ? stripInlineMarkdown(para.join(" ")) : null;
}

/**
 * Help headings that are statements of a question the section answers.
 * Only the question wording is ours; the answer is the section's text.
 */
const HELP_HEADING_QUESTIONS: Record<string, string> = {
  "What this is": "What is SmokySignal?",
  "Why we don't track you": "Does SmokySignal track me?",
  "Where the data comes from": "Where does SmokySignal's data come from?",
  "Push notifications": "How do SmokySignal push alerts work?",
};

/** FAQ entries from content/help.md (after fillHelpPlaceholders()). */
export function helpFaq(md: string): FaqEntry[] {
  const out: FaqEntry[] = [];
  for (const s of sections(md)) {
    if (s.level !== 2) continue;
    const mapped = HELP_HEADING_QUESTIONS[s.heading];
    const question = mapped ?? (s.heading.endsWith("?") ? s.heading : null);
    if (question) {
      const answer = firstParagraph(s.body);
      if (answer) out.push({ question, answer });
    }
    if (s.heading === "When something looks wrong") {
      for (const line of s.body) {
        const m = /^\s*[-*]\s+\*\*(.+?)\*\*\s*(.+)$/.exec(line);
        if (!m) continue;
        const q = stripInlineMarkdown(m[1]!).replace(/\.$/, "");
        const a = stripInlineMarkdown(m[2]!);
        // Deployment notes (missing env vars) are not rider questions.
        if (!q || !a || /environment variable/i.test(a)) continue;
        out.push({ question: troubleQuestion(q), answer: a });
      }
    }
  }
  return out;
}

/** "The activity feed is empty" → "What if the activity feed is empty?" */
function troubleQuestion(statement: string): string {
  if (statement.endsWith("?")) return statement;
  if (statement.startsWith('"')) return `What does ${statement} mean?`;
  const lower = /^[A-Z][a-z]/.test(statement)
    ? statement.charAt(0).toLowerCase() + statement.slice(1)
    : statement;
  return `What if ${lower}?`;
}
