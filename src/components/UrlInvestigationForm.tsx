import { ArrowRight, Globe2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizePublicUrl } from "../features/investigation/url";

type UrlInvestigationFormProps = {
  compact?: boolean;
  initialValue?: string;
};

export function UrlInvestigationForm({
  compact = false,
  initialValue = "",
}: UrlInvestigationFormProps) {
  const navigate = useNavigate();
  const inputId = useId();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string>();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = normalizePublicUrl(value);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(undefined);
    void navigate(`/investigate?url=${encodeURIComponent(result.normalizedUrl)}`);
  }

  return (
    <form className={`url-form${compact ? " url-form--compact" : ""}`} onSubmit={submit} noValidate>
      <div className="url-form__field">
        <Globe2 aria-hidden="true" size={18} />
        <label className="sr-only" htmlFor={inputId}>
          Public website URL
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder="https://example.com"
          aria-describedby={error ? `${inputId}-error` : undefined}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(undefined);
          }}
        />
        <button className="button button--primary" type="submit">
          <span>{compact ? "Run" : "Start investigation"}</span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p className="url-form__error" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
