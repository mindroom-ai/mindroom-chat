"""The sample plugin directory's tools (scripts/agent-stack/stack.py, E2E_PLUGIN_DIRS)."""

import uuid

from mindroom.plugin_api import (
    SetupType,
    ToolCategory,
    ToolFileAccess,
    Toolkit,
    ToolStatus,
    register_tool_with_metadata,
    tool,
)


class SampleTools(Toolkit):
    name = "e2e_sample"

    @tool
    def sample_greet(self, name: str) -> str:
        """Greet someone from the sample plugin.

        Args:
            name: The person's name.
        """
        return f"Hello {name}, from the sample plugin"

    @tool
    def sample_make(self) -> str:
        """Make a sample item and return its id."""
        return f"item-{uuid.uuid4().hex[:8]}"

    @tool
    def sample_use(self, item_id: str) -> str:
        """Use a sample item.

        Args:
            item_id: The id sample_make returned.
        """
        return f"Used {item_id}, from the sample plugin"


@register_tool_with_metadata(
    name="e2e_sample",
    file_access=ToolFileAccess.NONE,
    display_name="E2E sample",
    description="The end-to-end specs' sample plugin tool",
    category=ToolCategory.DEVELOPMENT,
    status=ToolStatus.AVAILABLE,
    setup_type=SetupType.NONE,
)
def sample_tools() -> type[SampleTools]:
    return SampleTools
