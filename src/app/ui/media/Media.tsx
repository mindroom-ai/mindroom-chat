import { type ComponentPropsWithRef } from 'react';
import classNames from 'classnames';
import * as css from './Media.css';

/** An attachment image that fills its message box. */
export function Image({ className, alt, ref, ...rest }: ComponentPropsWithRef<'img'>) {
  return <img ref={ref} alt={alt} {...rest} className={classNames(css.Image, className)} />;
}

/** An attachment video player that fills its message box. */
export function Video({ className, ref, ...rest }: ComponentPropsWithRef<'video'>) {
  // Matrix attachments carry no caption track to offer.
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video ref={ref} {...rest} className={classNames(css.Video, className)} />;
}
