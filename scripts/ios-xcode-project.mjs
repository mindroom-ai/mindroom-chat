// @ts-check
// Reads and writes build settings of one target in an Xcode project file (project.pbxproj, an
// OpenStep property list).

/**
 * The index of the `}` that closes the object opened at `open`, skipping quoted strings and
 * comments.
 * @param {string} text
 * @param {number} open index of `{`
 */
const closingBrace = (text, open) => {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
        if (text[index] === '\\') index += 1;
      }
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 1;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('Unbalanced braces in the Xcode project');
};

/** @param {string} value */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The range of the body (between the braces) of the object with the given ID.
 * @param {string} text
 * @param {string} id
 * @returns {{ start: number; end: number }}
 */
const objectRange = (text, id) => {
  const match = new RegExp(`(?:^|\\s)${escapeRegex(id)}(?:\\s*/\\*[^*]*\\*/)?\\s*=\\s*\\{`).exec(
    text
  );
  if (!match) throw new Error(`Xcode project object ${id} not found`);
  const open = match.index + match[0].length - 1;
  return { start: open + 1, end: closingBrace(text, open) };
};

/**
 * `key = value;` directly inside a body, with the value as written (quotes kept).
 * @param {string} key
 * @param {string} [flags]
 */
const settingPattern = (key, flags) =>
  new RegExp(
    `((?:^|[\\s;{])${escapeRegex(
      key
    )}\\s*=\\s*)("(?:[^"\\\\]|\\\\.)*"|[^;\\s]+)((?:\\s*/\\*[^*]*\\*/)?\\s*;)`,
    flags
  );

/**
 * @param {string} body
 * @param {string} key
 */
const scalar = (body, key) => settingPattern(key).exec(body)?.[2];

/**
 * @param {string} body
 * @param {string} key
 * @returns {string[]}
 */
const idList = (body, key) => {
  const match = new RegExp(`${escapeRegex(key)}\\s*=\\s*\\(([^)]*)\\)`).exec(body);
  if (!match) return [];
  return (match[1] ?? '')
    .replace(/\/\*[^*]*\*\//g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

/**
 * The ranges of the `buildSettings` bodies of every build configuration of the target.
 * @param {string} projectText
 * @param {string} targetName
 * @returns {Array<{ start: number; end: number }>}
 */
const targetBuildSettingsRanges = (projectText, targetName) => {
  const targetPattern = /(\w+)(?:\s*\/\*[^*]*\*\/)?\s*=\s*\{\s*isa\s*=\s*PBXNativeTarget\s*;/g;
  const target = [...projectText.matchAll(targetPattern)]
    .map((match) => {
      const open = (match.index ?? 0) + match[0].indexOf('{');
      return projectText.slice(open + 1, closingBrace(projectText, open));
    })
    .find((body) => {
      const name = scalar(body, 'name');
      return name === targetName || name === `"${targetName}"`;
    });
  if (!target) throw new Error(`Xcode target ${targetName} not found`);

  const listId = scalar(target, 'buildConfigurationList');
  if (!listId) throw new Error(`Xcode target ${targetName} has no build configuration list`);
  const list = objectRange(projectText, listId);
  const configurationIds = idList(projectText.slice(list.start, list.end), 'buildConfigurations');
  if (configurationIds.length === 0) {
    throw new Error(`Xcode target ${targetName} has no build configurations`);
  }

  return configurationIds.map((id) => {
    const configuration = objectRange(projectText, id);
    const body = projectText.slice(configuration.start, configuration.end);
    const match = /buildSettings\s*=\s*\{/.exec(body);
    if (!match) throw new Error(`Build configuration ${id} has no build settings`);
    const open = configuration.start + match.index + match[0].length - 1;
    return { start: open + 1, end: closingBrace(projectText, open) };
  });
};

/**
 * The value of one build setting of the target, as written in the project (quotes kept).
 * Every build configuration of the target must set it to the same value.
 * @param {string} projectText
 * @param {string} settingName the key as written, quoted when Xcode quotes it
 * @param {string} [targetName]
 * @returns {string}
 */
export const getSingleAppTargetBuildSettingValue = (
  projectText,
  settingName,
  targetName = 'App'
) => {
  const values = targetBuildSettingsRanges(projectText, targetName).map(({ start, end }) =>
    scalar(projectText.slice(start, end), settingName)
  );
  const [first] = values;
  if (first === undefined || values.some((value) => value !== first)) {
    throw new Error(
      `Build setting ${settingName} of target ${targetName} must have one value in every configuration`
    );
  }
  return first;
};

/**
 * Sets one build setting in every build configuration of the target and nowhere else (other
 * targets and the project-level configurations keep theirs). The setting must already exist.
 * @param {string} projectText
 * @param {string} settingName
 * @param {string} value written as is; quote it when Xcode would
 * @param {string} [targetName]
 * @returns {string}
 */
export const replaceAppTargetBuildSetting = (
  projectText,
  settingName,
  value,
  targetName = 'App'
) => {
  getSingleAppTargetBuildSettingValue(projectText, settingName, targetName);
  // Replace from the end so earlier ranges keep their offsets.
  return targetBuildSettingsRanges(projectText, targetName)
    .sort((a, b) => b.start - a.start)
    .reduce((text, { start, end }) => {
      const body = text
        .slice(start, end)
        .replace(
          settingPattern(settingName, 'g'),
          (_match, before, _old, after) => `${before}${value}${after}`
        );
      return `${text.slice(0, start)}${body}${text.slice(end)}`;
    }, projectText);
};
