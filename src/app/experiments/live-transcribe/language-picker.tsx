"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMMON_LANGUAGES, findLanguage } from "@/lib/live-transcribe/languages";
import {
  isValidLanguageCode,
  MAX_LANGUAGES,
} from "@/lib/realtime-transcribe";
import { cn } from "@/lib/utils";

export function LanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const atCapacity = value.length >= MAX_LANGUAGES;
  const available = COMMON_LANGUAGES.filter(
    (language) => !value.includes(language.code),
  );

  const add = (code: string) => {
    if (value.includes(code) || atCapacity) return;
    onChange([...value, code]);
  };

  const remove = (code: string) => {
    onChange(value.filter((item) => item !== code));
  };

  const addCustom = () => {
    const code = custom.trim().toLowerCase();
    if (!code) return;
    if (!isValidLanguageCode(code)) {
      setCustomError(`"${code}" is not a valid language code.`);
      return;
    }
    if (value.includes(code)) {
      setCustomError(`${code} is already selected.`);
      return;
    }
    setCustomError(null);
    setCustom("");
    add(code);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {value.length === 0 ? (
          <span className="text-muted-foreground text-sm">
            No languages selected — the model will auto-detect.
          </span>
        ) : (
          value.map((code) => {
            const known = findLanguage(code);
            return (
              <span
                key={code}
                className="bg-secondary text-secondary-foreground inline-flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2.5 text-sm"
              >
                <span>{known ? known.label : code}</span>
                <span className="text-muted-foreground font-mono text-[11px]">
                  {code}
                </span>
                <button
                  type="button"
                  onClick={() => remove(code)}
                  disabled={disabled}
                  aria-label={`Remove ${known ? known.english : code}`}
                  className={cn(
                    "hover:bg-background/80 rounded p-0.5 transition-colors",
                    disabled && "pointer-events-none opacity-50",
                  )}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            );
          })
        )}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        {/* Remounted on every change so the trigger always shows the
            placeholder rather than sticking on the last picked value. */}
        <Select
          key={`add-${value.join(",")}`}
          onValueChange={add}
          disabled={disabled || atCapacity || available.length === 0}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Add a language…" />
          </SelectTrigger>
          <SelectContent>
            {available.map((language) => (
              <SelectItem key={language.code} value={language.code}>
                <span className="flex items-baseline gap-2">
                  <span>{language.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {language.english !== language.label
                      ? `${language.english} · ${language.code}`
                      : language.code}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1">
            <Input
              value={custom}
              onChange={(event) => {
                setCustom(event.target.value);
                setCustomError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Other code, e.g. yue"
              disabled={disabled || atCapacity}
              autoComplete="off"
              spellCheck={false}
              className="w-44 font-mono"
              aria-label="Custom language code"
            />
            {customError ? (
              <span className="text-destructive text-xs">{customError}</span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={addCustom}
            disabled={disabled || atCapacity || custom.trim() === ""}
            aria-label="Add custom language code"
          >
            <Plus aria-hidden />
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        {atCapacity ? (
          `Maximum of ${MAX_LANGUAGES} languages reached.`
        ) : value.length === 0 ? (
          // Verified against the live API: auto-detect requires omitting the
          // field — an empty array is rejected with 400.
          "The languages field is omitted entirely — the API auto-detects."
        ) : (
          <>
            Sent as <code className="font-mono">{JSON.stringify(value)}</code>
          </>
        )}
      </p>
    </div>
  );
}
