import React from 'react';
import classNames from 'classnames';
import { ArgumentField, toArgumentFields } from './approvalArgumentFields';
import * as css from './ApprovalArgumentFields.css';

function FieldRows({ fields, clamp }: { fields: ArgumentField[]; clamp: boolean }) {
  return (
    <dl className={css.Fields}>
      {fields.map(({ key, value }) => (
        <React.Fragment key={key}>
          <dt className={css.Key}>{key}</dt>
          <dd className={css.Value}>
            {value.kind === 'nested' ? (
              <FieldRows fields={value.fields} clamp={clamp} />
            ) : value.kind === 'json' ? (
              <pre className={classNames(css.Code, clamp && css.Clamped)}>{value.text}</pre>
            ) : (
              <span
                className={classNames(value.kind === 'scalar' && css.Scalar, clamp && css.Clamped)}
              >
                {value.text}
              </span>
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Tool arguments as labeled fields; `limit` shows a clamped preview of the first fields. */
export function ApprovalArgumentFields({ value, limit }: { value: unknown; limit?: number }) {
  const parsed = toArgumentFields(value);
  if ('raw' in parsed) {
    return parsed.raw ? (
      <pre className={classNames(css.Code, limit !== undefined && css.Clamped)}>{parsed.raw}</pre>
    ) : null;
  }
  const fields = limit === undefined ? parsed.fields : parsed.fields.slice(0, limit);
  return fields.length > 0 ? <FieldRows fields={fields} clamp={limit !== undefined} /> : null;
}

export const countArgumentFields = (value: unknown): number => {
  const parsed = toArgumentFields(value);
  return 'fields' in parsed ? parsed.fields.length : 0;
};
