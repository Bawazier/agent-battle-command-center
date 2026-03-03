"""
CTO Orchestrator — Stateless decompose + review using Anthropic SDK directly.

Two functions:
  - decompose_prompt(prompt, language, context) → list of subtask dicts
  - review_results(prompt, subtask_results) → review dict

Uses anthropic.Anthropic (sync) — no CrewAI, no litellm.
Called exactly twice per mission: once to decompose, once to review.
"""

import json
import os
import re
from typing import Any

import anthropic

# Model for orchestration (Sonnet is cost-effective at ~$0.04/mission)
ORCHESTRATOR_MODEL = os.getenv(
    "ORCHESTRATOR_MODEL", "claude-sonnet-4-20250514"
)

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set — CTO orchestration requires Claude")
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


# ── Decompose ────────────────────────────────────────────────────────────────

DECOMPOSE_SYSTEM = """\
You are a CTO decomposing a user request into atomic coding subtasks.

Rules:
- Maximum 5 subtasks per mission. Prefer fewer, larger subtasks over many small ones.
- For web projects: combine HTML structure + CSS into a single file where possible.
  Example: one tasks/landing.html with inline <style> is better than separate HTML + CSS files.
- Each subtask produces ONE file with ONE function, ONE class, or ONE complete page/component.
- CRITICAL: file_name must be a FLAT path directly under tasks/ — NO subdirectories.
  Good:  tasks/app.py, tasks/landing_styles.css, tasks/landing.html, tasks/nav.js
  BAD:   tasks/static/css/style.css, tasks/templates/index.html, tasks/src/utils.ts
  The coder agent cannot create nested directories. All files must be tasks/filename.ext.
- For multi-file projects, use descriptive flat names: tasks/landing_header.html, tasks/landing_styles.css

## VALIDATION COMMAND RULES (CRITICAL — mismatches cause stuck tasks!)

The validation_command MUST reference the EXACT SAME file as file_name. If file_name is
"tasks/payment.py", the validation_command MUST import from "tasks.payment", NOT "tasks.schema".

### Validation Command Templates by Language:

**Python (function):**
  file_name: "tasks/calculator.py"
  validation_command: "python3 -c \\"from tasks.calculator import add; assert add(2,3)==5; print('PASS')\\"

**Python (class):**
  file_name: "tasks/stack.py"
  validation_command: "python3 -c \\"from tasks.stack import Stack; s=Stack(); s.push(1); assert s.pop()==1; print('PASS')\\"

**JavaScript:**
  file_name: "tasks/utils.js"
  validation_command: "node -e \\"const {add} = require('./tasks/utils.js'); if(add(2,3)!==5) throw 'FAIL'; console.log('PASS')\\"

**TypeScript:**
  file_name: "tasks/utils.ts"
  validation_command: "tsx -e \\"import {add} from './tasks/utils'; if(add(2,3)!==5) throw 'FAIL'; console.log('PASS')\\"

**Go:**
  file_name: "tasks/main.go"
  validation_command: "go run tasks/main.go | grep -q 'expected_output' && echo PASS || echo FAIL"

**PHP:**
  file_name: "tasks/utils.php"
  validation_command: "php -r \\"require 'tasks/utils.php'; assert(add(2,3)===5); echo 'PASS';\\"

**HTML (content validation):**
  file_name: "tasks/store.html"
  validation_command: "python3 -c \\"c=open('tasks/store.html').read(); assert len(c)>500,'Too short'; assert 'ByteForge' in c,'Missing brand'; assert 'Titan X' in c,'Missing product'; print('PASS')\\"
  Pick 2-3 MUST-HAVE strings from the requirements for each HTML file's assertions.

**CSS (content validation):**
  file_name: "tasks/styles.css"
  validation_command: "python3 -c \\"c=open('tasks/styles.css').read(); assert len(c)>800,'Too short'; assert '@media' in c,'Missing responsive'; assert '#00d4ff' in c or '#0a0a0a' in c,'Missing theme colors'; print('PASS')\\"
  Pick the primary brand color and require @media for responsive CSS.

**JavaScript (content validation):**
  file_name: "tasks/app.js"
  validation_command: "python3 -c \\"c=open('tasks/app.js').read(); assert len(c)>300,'Too short'; assert 'function' in c or '=>' in c,'Missing functions'; print('PASS')\\"

**Static files (existence only — use ONLY for non-code assets like images):**
  file_name: "tasks/data.json"
  validation_command: "python3 -c \\"import os; assert os.path.exists('tasks/data.json'); print('PASS')\\""

### Validation Rules:
- validation_command MUST print "PASS" on success (exact string)
- validation_command MUST reference the SAME file as file_name (no mismatches!)
- For Python modules, the import path derives from file_name: tasks/foo.py → from tasks.foo import ...
- For HTML/CSS/JS files, use content validation (assert length + key strings) — NOT os.path.exists()
- Only use os.path.exists() for non-code assets (images, data files)

## CONTENT PASSTHROUGH RULES (CRITICAL for quality)

The coder agent ONLY sees the subtask description — it does NOT see the original user prompt.
Therefore you MUST copy ALL specific content into each subtask description:

1. **Text content** — product names, prices, taglines, headings, button labels
   Copy them VERBATIM into the description. Do NOT summarize.
2. **Visual specs** — hex colors, font sizes, breakpoints, column counts
   List every value explicitly.
3. **Behavioral specs** — what each button does, form validation rules, animation triggers
   Describe each interaction precisely.

### BAD (vague — coder writes placeholders):
  "Create an HTML page with a products grid showing 6 gaming PCs with specs and prices"

### GOOD (specific — coder writes real content):
  "Create an HTML page. The products grid has 6 items:
   - Titan X: $2,499 — RTX 4080, i7-14700K, 32GB DDR5, 1TB NVMe
   - Shadow: $1,799 — RTX 4070 Ti, R7 7800X3D, 32GB DDR5, 1TB NVMe
   - Nova Pro: $3,299 — RTX 4090, i9-14900K, 64GB DDR5, 2TB NVMe
   (etc.)"

### FILE NAMING ENFORCEMENT
Always end EVERY subtask description with:
"CRITICAL: Write your output to EXACTLY this file path: {file_name}"

## WEB PROJECT STRATEGY
For landing pages and simple websites:
- Prefer 2 subtasks over 3: combine HTML+CSS into one file (inline <style>) + JS as second file
- If 3 files needed: HTML subtask gets ALL text content, CSS/JS reference specific IDs/classes
- HTML is always subtask #1 (others depend on it)

- Estimate complexity 1-10 per subtask (see scale below).
- Order subtasks by dependency — earlier subtasks should not depend on later ones.
- Return ONLY a valid JSON array, no markdown fences, no extra text.
- Do NOT ask questions or add commentary — decompose whatever was asked, making reasonable assumptions.

Complexity scale:
  1-2: Trivial (single-step, clear I/O)
  3-4: Low (linear logic, well-defined)
  5-6: Moderate (conditionals, validation, helpers)
  7-8: Complex (algorithms, data structures, multiple functions)
  9:   Extreme (full class: Stack, LRU Cache, etc.)

Complexity guidelines for web projects:
- Simple HTML (1-2 sections, boilerplate): 3-4
- Full-page HTML (5+ sections, real content, semantic markup): 7
- CSS with responsive grid + animations + theme: 7
- JavaScript with 3+ interactive features: 6-7
Web projects should generally be rated 7+ so they get 32K context.

JSON schema per subtask:
{
  "title": "short title",
  "description": "detailed requirements including function signature, edge cases, examples",
  "file_name": "tasks/module_name.py",
  "validation_command": "python3 -c \\"from tasks.module_name import func; assert func(2,3)==5; print('PASS')\\"",
  "complexity": 5,
  "language": "python"
}
"""


def decompose_prompt(
    prompt: str,
    language: str = "python",
    context: str | None = None,
) -> list[dict[str, Any]]:
    """Call Sonnet to decompose a user prompt into subtasks."""
    client = _get_client()

    user_content = f"Language: {language}\n\nUser request:\n{prompt}"
    if context:
        user_content += f"\n\nAdditional context:\n{context}"

    response = client.messages.create(
        model=ORCHESTRATOR_MODEL,
        max_tokens=4096,
        system=DECOMPOSE_SYSTEM,
        messages=[{"role": "user", "content": user_content}],
        temperature=0,
    )

    raw = response.content[0].text.strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        # Remove first and last fence lines
        lines = [line for line in lines if not line.strip().startswith("```")]
        raw = "\n".join(lines).strip()

    # If response contains conversational text before JSON, extract the JSON array.
    # Sonnet sometimes prepends questions/commentary before the actual JSON output.
    if not raw.startswith("["):
        match = re.search(r'\[', raw)
        if match:
            raw = raw[match.start():]
        else:
            raise ValueError(
                "Response did not contain a JSON array. Model returned conversational text. "
                "Try rephrasing as a concrete coding task."
            )

    subtasks = json.loads(raw)
    if not isinstance(subtasks, list):
        raise ValueError(f"Expected JSON array, got {type(subtasks).__name__}")

    # Hard cap: truncate to 7 subtasks max (prompt says 5, but allow small overflow)
    MAX_SUBTASKS = 7
    if len(subtasks) > MAX_SUBTASKS:
        print(f"[Orchestrator] WARNING: {len(subtasks)} subtasks exceeds cap of {MAX_SUBTASKS}, truncating")
        subtasks = subtasks[:MAX_SUBTASKS]

    # Validate required fields and flatten nested paths
    for i, st in enumerate(subtasks):
        for field in ("title", "description", "file_name", "validation_command", "complexity"):
            if field not in st:
                raise ValueError(f"Subtask {i} missing required field: {field}")
        # Default language if missing
        if "language" not in st:
            st["language"] = language

        # Flatten nested file paths: tasks/static/css/style.css → tasks/style.css
        fn = st["file_name"]
        if fn.startswith("tasks/") and fn.count("/") > 1:
            flat_name = fn.split("/")[-1]
            old_fn = fn
            st["file_name"] = f"tasks/{flat_name}"
            # Also fix validation_command references to the old path
            st["validation_command"] = st["validation_command"].replace(old_fn, st["file_name"])

        # ── Validate file_name matches validation_command (Mar 2, 2026 fix) ──
        # Prevent mismatches like: file_name="payment_system.prisma" but validation expects "schema.prisma"
        file_name = st["file_name"]
        val_cmd = st["validation_command"]

        # Extract basename for checking
        expected_basename = os.path.basename(file_name)

        # Auto-fix: Check os.path.exists() references
        if "exists" in val_cmd and "'" in val_cmd:
            matches = re.findall(r"exists\('([^']+)'\)", val_cmd)
            if matches:
                expected_file = matches[0]
                expected_basename_in_cmd = os.path.basename(expected_file)

                if expected_basename_in_cmd != expected_basename:
                    # Auto-fix: replace wrong path with correct file_name
                    print(f"[Orchestrator] Auto-fixing validation mismatch: "
                          f"'{expected_file}' → '{file_name}'")
                    st["validation_command"] = val_cmd.replace(expected_file, file_name)

        # Auto-fix: Check Python import references (from tasks.wrong import ...)
        if file_name.endswith(".py"):
            # Expected module: tasks/calculator.py → tasks.calculator
            expected_module = file_name.replace("/", ".").replace(".py", "")
            import_matches = re.findall(r"from (tasks\.\w+) import", val_cmd)
            for found_module in import_matches:
                if found_module != expected_module:
                    print(f"[Orchestrator] Auto-fixing Python import mismatch: "
                          f"'{found_module}' → '{expected_module}'")
                    st["validation_command"] = val_cmd.replace(found_module, expected_module)

        # Auto-fix: Check JS/Node require references
        if file_name.endswith(".js"):
            require_matches = re.findall(r"require\(['\"](\./tasks/[^'\"]+)['\"]\)", val_cmd)
            expected_require = f"./{file_name}"
            for found_path in require_matches:
                if found_path != expected_require:
                    print(f"[Orchestrator] Auto-fixing JS require mismatch: "
                          f"'{found_path}' → '{expected_require}'")
                    st["validation_command"] = st["validation_command"].replace(
                        found_path, expected_require
                    )

    return subtasks


# ── Review ───────────────────────────────────────────────────────────────────

REVIEW_SYSTEM = """\
You are a CTO reviewing completed coding subtasks against the original user request.

For each subtask you receive:
- title, file_name, status (passed/failed), code (if available), error (if failed)

Rate overall quality 0-10. Identify any issues.

Return ONLY valid JSON (no markdown fences):
{
  "approved": true/false,
  "score": 8.5,
  "summary": "Brief overall assessment",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "file": "tasks/example.py",
      "issue": "Description of the issue",
      "suggestion": "How to fix it"
    }
  ]
}

Approve (true) if score >= 7 and no critical findings.
"""


def review_results(
    prompt: str,
    subtask_results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Call Sonnet to review all completed subtask results."""
    client = _get_client()

    # Format subtask results for review
    results_text = ""
    for i, st in enumerate(subtask_results, 1):
        results_text += f"\n--- Subtask {i}: {st.get('title', 'Unknown')} ---\n"
        results_text += f"File: {st.get('file_name', 'unknown')}\n"
        results_text += f"Status: {'PASS' if st.get('validation_passed') else 'FAIL'}\n"
        if st.get("code"):
            results_text += f"Code:\n```\n{st['code']}\n```\n"
        if st.get("error"):
            results_text += f"Error: {st['error']}\n"

    user_content = (
        f"Original user request:\n{prompt}\n\n"
        f"Subtask results:\n{results_text}"
    )

    response = client.messages.create(
        model=ORCHESTRATOR_MODEL,
        max_tokens=2048,
        system=REVIEW_SYSTEM,
        messages=[{"role": "user", "content": user_content}],
        temperature=0,
    )

    raw = response.content[0].text.strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        raw = "\n".join(lines).strip()

    review = json.loads(raw)
    if not isinstance(review, dict):
        raise ValueError(f"Expected JSON object, got {type(review).__name__}")

    # Ensure required fields
    review.setdefault("approved", False)
    review.setdefault("score", 0)
    review.setdefault("summary", "")
    review.setdefault("findings", [])

    return review


# ── Clarify ───────────────────────────────────────────────────────────────────

CLARIFY_SYSTEM = """\
You are a senior architect. Analyze the user's coding request for clarity and complexity.

Your job: Assess how many guiding questions (0-5) would help the user clarify their intent.

Criteria:
- **Simple/Clear (0-1 questions)**: Single function, clear specification, no ambiguity
  Examples: "Create a function that reverses strings", "Validate email addresses"
- **Moderate (2-3 questions)**: Small app with some ambiguity, need to clarify features/design
  Examples: "Build a todo app", "Create a calculator", "Make a web form"
- **Complex (4-5 questions)**: System design, multiple integrations, architecture decisions needed
  Examples: "Build a chat app", "Create a REST API with auth", "Design a marketplace"

Return ONLY valid JSON (no markdown, no extra text):
{
  "questions": [
    "Question 1?",
    "Question 2?",
    ...
  ]
}

If the request is clear and complete, return empty questions list: {"questions": []}
"""


def clarify_intent(prompt: str) -> dict[str, Any]:
    """Call Sonnet to generate clarifying questions for a user request."""
    client = _get_client()

    response = client.messages.create(
        model=ORCHESTRATOR_MODEL,
        max_tokens=512,
        system=CLARIFY_SYSTEM,
        messages=[{"role": "user", "content": f"User request:\n{prompt}"}],
        temperature=0,
    )

    raw = response.content[0].text.strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        raw = "\n".join(lines).strip()

    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError(f"Expected JSON object, got {type(result).__name__}")

    # Ensure questions field exists
    result.setdefault("questions", [])

    return result
