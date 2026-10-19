"""How a tool is described to the model: a name, a description and a JSON schema."""

TEXT = {"type": "string", "maxLength": 100000}
ID = {"type": "string", "pattern": r"^[0-9a-f-]{36}$"}
REV = {"type": "integer", "minimum": 1}


def tool(name, description, properties=None, required=None, write=False):
    return {
        "name": name,
        "label": description.split("。")[0],
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties or {},
            "required": required or [],
            "additionalProperties": False,
        },
        "write": write,
    }
