import { useState, useRef, useCallback } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info } from "lucide-react";

interface InfoTipProps {
  text: string;
  className?: string;
  iconSize?: string;
}

export function InfoTip({ text, className = "", iconSize = "h-3.5 w-3.5" }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        onMouseEnter={handleEnter}
        onMouseLeave={scheduleClose}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <button
          type="button"
          className={`inline-flex items-center justify-center text-muted-foreground/60 hover:text-muted-foreground transition-colors ${className}`}
          aria-label="More info"
          data-testid="button-info-tip"
        >
          <Info className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="max-w-[260px] text-xs leading-relaxed p-3"
        onMouseEnter={handleEnter}
        onMouseLeave={scheduleClose}
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}
