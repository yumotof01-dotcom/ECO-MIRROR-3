"""Independent structural JSON Schema check. Requires jsonschema==4.26.0 (test tooling only)."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

schema = json.loads(Path('contracts/research-snapshot.schema.json').read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema, format_checker=FormatChecker())
files = list(Path('.artifacts/snapshot-examples').glob('*.json'))
assert len(files) == 30, 'Expected 6 regions x 5 query types'
for file in files:
    value = json.loads(file.read_text())
    validator.validate(value)
    value['payload']['provenance']['release']['year'] = 2026
    assert list(validator.iter_errors(value)), 'Schema accepted a forged observation year'
print('SNAPSHOT_JSON_SCHEMA_AUDIT=PASS 30 real-data exports, 30 forged-year rejections')
