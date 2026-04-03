import * as React from 'react';

import {
  AlertDialog as AlertDialogPrimitive,
  AlertDialogPopup as AlertDialogPopupPrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialogFooter as AlertDialogFooterPrimitive,
  AlertDialogHeader as AlertDialogHeaderPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
  AlertDialogTrigger as AlertDialogTriggerPrimitive,
  AlertDialogPortal as AlertDialogPortalPrimitive,
  AlertDialogBackdrop as AlertDialogBackdropPrimitive,
  AlertDialogClose as AlertDialogClosePrimitive,
} from '@/components/animate-ui/primitives/base/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive>) {
  return <AlertDialogPrimitive {...props} />;
}

function AlertDialogTrigger(
  props: React.ComponentProps<typeof AlertDialogTriggerPrimitive>,
) {
  return <AlertDialogTriggerPrimitive {...props} />;
}

function AlertDialogBackdrop({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogBackdropPrimitive>) {
  return (
    <AlertDialogBackdropPrimitive
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

function AlertDialogPopup({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPopupPrimitive>) {
  return (
    <AlertDialogPortalPrimitive>
      <AlertDialogBackdrop />
      <AlertDialogPopupPrimitive
        className={cn(
          'bg-background fixed left-1/2 top-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border p-6 shadow-lg sm:max-w-lg',
          className,
        )}
        {...props}
      />
    </AlertDialogPortalPrimitive>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogHeaderPrimitive>) {
  return (
    <AlertDialogHeaderPrimitive
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogFooterPrimitive>) {
  return (
    <AlertDialogFooterPrimitive
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogTitlePrimitive>) {
  return (
    <AlertDialogTitlePrimitive
      className={cn('text-lg font-semibold', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogDescriptionPrimitive>) {
  return (
    <AlertDialogDescriptionPrimitive
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogClosePrimitive>) {
  return (
    <AlertDialogClosePrimitive
      className={cn(buttonVariants(), className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogClosePrimitive>) {
  return (
    <AlertDialogClosePrimitive
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
};
