// @ts-check
// Reads build settings from an Xcode project file (project.pbxproj, an OpenStep property list).

/**
 * The text between the braces of the object that starts at `open` (which must be `{`),
 * skipping quoted strings and comments.
 * @param {string} text
 * @param {number} open
 */
const objectBody = (text, open) => {
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
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  throw new Error('Unbalanced braces in the Xcode project');
};

/** @param {string} value */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The body of the object with the given ID.
 * @param {string} text
 * @param {string} id
 */
const objectById = (text, id) => {
  const match = new RegExp(`(?:^|\\s)${escapeRegex(id)}(?:\\s*/\\*[^*]*\\*/)?\\s*=\\s*\\{`).exec(
    text
  );
  if (!match) throw new Error(`Xcode project object ${id} not found`);
  return objectBody(text, match.index + match[0].length - 1);
};

/**
 * The value of `key = value;` directly inside `body`, with quotes kept.
 * @param {string} body
 * @param {string} key
 */
const scalar = (body, key) => {
  const match = new RegExp(
    `(?:^|[\\s;{])${escapeRegex(
      key
    )}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|[^;\\s]+)(?:\\s*/\\*[^*]*\\*/)?\\s*;`
  ).exec(body);
  return match?.[1];
};

/**
 * @param {string} body
 * @param {string} key
 * @returns {string[]}
 */
const idList = (body, key) => {
  const match = new RegExp(`${escapeRegex(key)}\\s*=\\s*\\(([^)]*)\\)`).exec(body);
  if (!match) return [];
  return match[1]
    .replace(/\/\*[^*]*\*\//g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

/**
 * @param {string} body
 */
const buildSettingsOf = (body) => {
  const match = /buildSettings\s*=\s*\{/.exec(body);
  if (!match) return '';
  return objectBody(body, match.index + match[0].length - 1);
};

/**
 * The value of one build setting of the `App` target, as written in the project (quotes kept).
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
  const targetPattern = /(\w+)(?:\s*\/\*[^*]*\*\/)?\s*=\s*\{\s*isa\s*=\s*PBXNativeTarget\s*;/g;
  const targets = [...projectText.matchAll(targetPattern)].map((match) => ({
    id: match[1],
    body: objectBody(projectText, (match.index ?? 0) + match[0].indexOf('{')),
  }));
  const target = targets.find(({ body }) => {
    const name = scalar(body, 'name');
    return name === targetName || name === `"${targetName}"`;
  });
  if (!target) throw new Error(`Xcode target ${targetName} not found`);

  const listId = scalar(target.body, 'buildConfigurationList');
  if (!listId) throw new Error(`Xcode target ${targetName} has no build configuration list`);
  const configurationIds = idList(objectById(projectText, listId), 'buildConfigurations');
  if (configurationIds.length === 0) {
    throw new Error(`Xcode target ${targetName} has no build configurations`);
  }

  const values = configurationIds.map((id) =>
    scalar(buildSettingsOf(objectById(projectText, id)), settingName)
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
 * Replaces one build setting in every configuration of the target.
 * @param {string} projectText
 * @param {string} settingName
 * @param {string} value
 * @param {string} [targetName]
 */
export const setAppTargetBuildSettingValue = (
  projectText,
  settingName,
  value,
  targetName = 'App'
) => {
  getSingleAppTargetBuildSettingValue(projectText, settingName, targetName);
  const pattern = new RegExp(
    `((?:^|[\\s;{])${escapeRegex(settingName)}\\s*=\\s*)("(?:[^"\\\\]|\\\\.)*"|[^;\\s]+)(\\s*;)`,
    'g'
  );
  return projectText.replace(pattern, (_match, before, _old, after) => `${before}${value}${after}`);
};
