import { MINDROOM_COMMANDS, type MindroomCommandItem } from './mindroomCommands';

/** The `!` commands whose name starts with what the user typed after the `!`. */
export const getMindroomCommandSuggestions = (text: string): MindroomCommandItem[] => {
  const typed = text.toLowerCase();
  return MINDROOM_COMMANDS.filter((command) => command.name.toLowerCase().startsWith(typed));
};
