import { ImgHTMLAttributes, VideoHTMLAttributes, forwardRef } from 'react';
import classNames from 'classnames';
import * as css from './Media.css';

/** An attachment image that fills its message box. */
export const Image = forwardRef<HTMLImageElement, ImgHTMLAttributes<HTMLImageElement>>(
  function Image({ className, alt, ...rest }, ref) {
    return <img ref={ref} alt={alt} {...rest} className={classNames(css.Image, className)} />;
  }
);
Image.displayName = 'Image';

/** An attachment video player that fills its message box. */
export const Video = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement>>(
  function Video({ className, ...rest }, ref) {
    // Matrix attachments carry no caption track to offer.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video ref={ref} {...rest} className={classNames(css.Video, className)} />;
  }
);
Video.displayName = 'Video';
