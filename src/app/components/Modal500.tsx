import React, { ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { Modal } from './glass/GlassPrimitives';
import { stopPropagation } from '../utils/keyboard';




















            returnFocusOnDeactivate: true,
            initialFocus: false,
          }}
        >
          <Modal variant="Background" size="500">
            {children}
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
