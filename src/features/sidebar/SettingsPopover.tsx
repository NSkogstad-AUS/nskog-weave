import { RadioGroup } from 'radix-ui';
import { MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { APP_FONTS, useAppFont } from '@/hooks/use-app-font';
import { type ThemeMode, useTheme } from '@/hooks/use-theme';

// ─── Card-style radio option ──────────────────────────────────────────────────

interface ThemeOptionProps {
  value: ThemeMode;
  icon: React.ReactNode;
  label: string;
}

function ThemeOption({ value, icon, label }: ThemeOptionProps) {
  return (
    <RadioGroup.Item
      value={value}
      className={cn(
        'group flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg border px-3 py-3 text-sm outline-none transition-all',
        // default
        'border-border bg-muted/40 text-muted-foreground',
        // hover
        'hover:border-border hover:bg-muted hover:text-foreground',
        // checked — clearly elevated
        'data-[state=checked]:border-foreground/30 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm',
        // focus
        'focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </RadioGroup.Item>
  );
}

// ─── Settings popover ─────────────────────────────────────────────────────────

export function SettingsPopover() {
  const { theme, setTheme } = useTheme();
  const { font, setFont } = useAppFont();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className="flex size-9 items-center justify-center rounded-2xl border border-sidebar-border bg-background/80 text-muted-foreground shadow-sm transition hover:text-foreground"
        >
          <SettingsIcon className="size-4" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="right"
        align="end"
        sideOffset={12}
        className="w-64 gap-0 p-0 shadow-xl ring-1 ring-border/60"
      >
        {/* Header */}
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-[13px] font-semibold text-foreground">Settings</p>
        </div>

        <div className="p-4 space-y-5">
          {/* Appearance */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Appearance
            </p>
            <RadioGroup.Root
              value={theme}
              onValueChange={(v) => setTheme(v as ThemeMode)}
              className="flex gap-2"
            >
              <ThemeOption value="light" icon={<SunIcon />} label="Light" />
              <ThemeOption value="dark" icon={<MoonIcon />} label="Dark" />
              <ThemeOption value="system" icon={<MonitorIcon />} label="System" />
            </RadioGroup.Root>
          </div>

          <div className="h-px bg-border/60" />

          {/* Font */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Font
            </p>
            <select
              aria-label="Font family"
              value={font}
              onChange={(e) => setFont(e.target.value)}
              className="h-8 w-full rounded-lg border border-border bg-muted/40 px-2.5 text-sm text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              {APP_FONTS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
