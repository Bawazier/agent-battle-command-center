import os
import tempfile
import subprocess
from pathlib import Path
from crewai_tools import BaseTool
from src.monitoring import ActionHistory, ActionLoopDetected


class ValidateSyntaxTool(BaseTool):
    name: str = "validate_syntax"
    description: str = """Validate code syntax before writing to file.
    Catches literal newlines, unclosed brackets, and other syntax errors early.
    Args: code (str), language (str: python|javascript|typescript|go|php)
    Returns: "OK" or detailed syntax error message"""

    def _run(self, code: str, language: str) -> str:
        try:
            # Register action and check for loops
            ActionHistory.register_action("validate_syntax", {
                "language": language,
                "code_length": len(code)
            })

            language = language.lower()

            # Map language to file extension and validator command
            validators = {
                'python': ('.py', ['python3', '-m', 'py_compile']),
                'javascript': ('.js', ['node', '--check']),
                'typescript': ('.ts', ['npx', '-y', 'tsx', '--help']),  # tsx doesn't have --check, fallback
                'go': ('.go', ['gofmt', '-e']),
                'php': ('.php', ['php', '-l'])
            }

            if language not in validators:
                return f"Unsupported language: {language}. Supported: {', '.join(validators.keys())}"

            ext, cmd = validators[language]

            # Create temp file with code
            with tempfile.NamedTemporaryFile(mode='w', suffix=ext, delete=False, encoding='utf-8') as f:
                f.write(code)
                temp_path = f.name

            try:
                # Special handling for TypeScript (tsx doesn't support syntax check)
                if language == 'typescript':
                    # Use Node.js to parse as module
                    result = subprocess.run(
                        ['node', '--input-type=module', '--check'],
                        input=code,
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                else:
                    # Run language-specific syntax checker
                    result = subprocess.run(
                        cmd + [temp_path],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )

                # Check results
                if result.returncode == 0:
                    return "OK"
                else:
                    error = result.stderr or result.stdout
                    # Clean up temp path from error message
                    error = error.replace(temp_path, f"<temp>{ext}")
                    return f"Syntax error:\n{error.strip()}"

            except subprocess.TimeoutExpired:
                return "Validation timeout (code too complex?)"
            except Exception as e:
                return f"Validation failed: {str(e)}"
            finally:
                # Clean up temp file
                try:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                except Exception:
                    pass  # Ignore cleanup errors

        except ActionLoopDetected as e:
            return str(e)
        except Exception as e:
            return f"Error during validation: {str(e)}"


# Export tool instance
validate_syntax = ValidateSyntaxTool()
