"""The sample plugin directory's tool (scripts/agent-stack/stack.py, E2E_PLUGIN_DIRS)."""

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
