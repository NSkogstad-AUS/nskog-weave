'use client';

import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui-components/react/alert-dialog';
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react';

import { useControlledState } from '@/hooks/use-controlled-state';
import { getStrictContext } from '@/lib/get-strict-context';

type AlertDialogContextType = {
  isOpen: boolean;
  setIsOpen: NonNullable<AlertDialogProps['onOpenChange']>;
};

const [AlertDialogProvider, useAlertDialog] =
  getStrictContext<AlertDialogContextType>('AlertDialogContext');

type AlertDialogProps = React.ComponentProps<typeof AlertDialogPrimitive.Root>;
type AlertDialogOnOpenRest = Parameters<
  NonNullable<AlertDialogProps['onOpenChange']>
> extends [boolean, ...infer Rest]
  ? Rest
  : [];

function AlertDialog(props: AlertDialogProps) {
  const [isOpen, setIsOpen] = useControlledState<boolean, AlertDialogOnOpenRest>({
    value: props.open,
    defaultValue: props.defaultOpen,
    onChange: props.onOpenChange,
  });

  return (
    <AlertDialogProvider value={{ isOpen, setIsOpen }}>
      <AlertDialogPrimitive.Root
        data-slot="alert-dialog"
        {...props}
        onOpenChange={setIsOpen}
      />
    </AlertDialogProvider>
  );
}

type AlertDialogTriggerProps = React.ComponentProps<typeof AlertDialogPrimitive.Trigger>;

function AlertDialogTrigger(props: AlertDialogTriggerProps) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

type AlertDialogPortalProps = Omit<
  React.ComponentProps<typeof AlertDialogPrimitive.Portal>,
  'keepMounted'
>;

function AlertDialogPortal(props: AlertDialogPortalProps) {
  const { isOpen } = useAlertDialog();

  return (
    <AnimatePresence>
      {isOpen ? (
        <AlertDialogPrimitive.Portal
          data-slot="alert-dialog-portal"
          keepMounted
          {...props}
        />
      ) : null}
    </AnimatePresence>
  );
}

type AlertDialogBackdropProps = Omit<
  React.ComponentProps<typeof AlertDialogPrimitive.Backdrop>,
  'render'
> &
  HTMLMotionProps<'div'>;

function AlertDialogBackdrop({
  transition = { duration: 0.2, ease: 'easeInOut' },
  ...props
}: AlertDialogBackdropProps) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-backdrop"
      render={
        <motion.div
          key="alert-dialog-backdrop"
          initial={{ opacity: 0, filter: 'blur(4px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(4px)' }}
          transition={transition}
          {...props}
        />
      }
    />
  );
}

type AlertDialogPopupProps = Omit<
  React.ComponentProps<typeof AlertDialogPrimitive.Popup>,
  'render'
> &
  HTMLMotionProps<'div'> & {
    from?: 'top' | 'bottom' | 'left' | 'right';
  };

function AlertDialogPopup({
  from = 'top',
  initialFocus,
  finalFocus,
  transition = { type: 'spring', stiffness: 150, damping: 25 },
  ...props
}: AlertDialogPopupProps) {
  const initialRotation =
    from === 'bottom' || from === 'left' ? '20deg' : '-20deg';
  const isVertical = from === 'top' || from === 'bottom';
  const rotateAxis = isVertical ? 'rotateX' : 'rotateY';

  return (
    <AlertDialogPrimitive.Popup
      initialFocus={initialFocus}
      finalFocus={finalFocus}
      render={
        <motion.div
          key="alert-dialog-popup"
          data-slot="alert-dialog-popup"
          initial={{
            opacity: 0,
            filter: 'blur(4px)',
            transform: `perspective(500px) ${rotateAxis}(${initialRotation}) scale(0.8)`,
          }}
          animate={{
            opacity: 1,
            filter: 'blur(0px)',
            transform: `perspective(500px) ${rotateAxis}(0deg) scale(1)`,
          }}
          exit={{
            opacity: 0,
            filter: 'blur(4px)',
            transform: `perspective(500px) ${rotateAxis}(${initialRotation}) scale(0.8)`,
          }}
          transition={transition}
          {...props}
        />
      }
    />
  );
}

type AlertDialogCloseProps = React.ComponentProps<typeof AlertDialogPrimitive.Close>;

function AlertDialogClose(props: AlertDialogCloseProps) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />;
}

type AlertDialogHeaderProps = React.ComponentProps<'div'>;

function AlertDialogHeader(props: AlertDialogHeaderProps) {
  return <div data-slot="alert-dialog-header" {...props} />;
}

type AlertDialogFooterProps = React.ComponentProps<'div'>;

function AlertDialogFooter(props: AlertDialogFooterProps) {
  return <div data-slot="alert-dialog-footer" {...props} />;
}

type AlertDialogTitleProps = React.ComponentProps<typeof AlertDialogPrimitive.Title>;

function AlertDialogTitle(props: AlertDialogTitleProps) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" {...props} />;
}

type AlertDialogDescriptionProps = React.ComponentProps<
  typeof AlertDialogPrimitive.Description
>;

function AlertDialogDescription(props: AlertDialogDescriptionProps) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
  useAlertDialog,
};
