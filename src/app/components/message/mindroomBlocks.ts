export type MindroomToolBlockStatus = 'pending' | 'completed' | 'completed_with_result';

export type MindroomToolBlockParseResult = {
  status: MindroomToolBlockStatus;
  command: string;
  result?: string;
  resultInline: boolean;
};

export const parseMindroomToolBlock = (raw: string): MindroomToolBlockParseResult => {
  const firstNewLine = raw.indexOf('\n');
  if (firstNewLine < 0) {
    return {
      status: 'pending',
      command: raw.trim(),
      resultInline: false,
    };
  }

  const command = raw.slice(0, firstNewLine).trim();
  const result = raw.slice(firstNewLine + 1).replace(/^\n+/, '');
  const trimmedResult = result.trim();

  if (trimmedResult.length === 0) {
    return {
      status: 'completed',
      command,
      resultInline: false,
    };
  }

  return {
    status: 'completed_with_result',
    command,
    result: trimmedResult,
    resultInline: !trimmedResult.includes('\n'),
  };
};
