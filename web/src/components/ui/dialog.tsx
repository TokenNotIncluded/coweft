import type { ReactNode, RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';

export function Modal({ open, onOpenChange, title, description, children, layout = 'default', finalFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string;
  description?: string; children: ReactNode; layout?: 'default' | 'editor' | 'sheet' | 'reader'; finalFocus?: RefObject<HTMLElement | null>;
}) {
  const edge = layout === 'sheet' || layout === 'reader';
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="dialog-backdrop"/>
      <Dialog.Viewport className={`dialog-viewport ${edge ? `${layout}-viewport` : ''}`}>
        <Dialog.Popup finalFocus={finalFocus} className={`dialog-popup dialog-${layout}`}>
          <div className="dialog-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="button button-icon button-ghost" aria-label="关闭"><X size={19}/></Dialog.Close></div>
          {description && <Dialog.Description className="dialog-description">{description}</Dialog.Description>}
          {children}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
