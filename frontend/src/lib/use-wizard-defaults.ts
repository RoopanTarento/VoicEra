"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { AgentForm } from "@/lib/wizard-data";
import {
  defaultModelFromSettings,
  modelOptionsFromSettings,
  pickFirstProvider,
  voiceOptionsFromSettings,
  type WizardCatalogs,
} from "@/lib/use-wizard-catalogs";

function providerStillValid(list: Record<string, unknown>, id: string): boolean {
  return Boolean(id && id in list);
}

/** Keeps the form's providers, models and voice on the best available
 * choice for its languages: the full wizard shows them for editing, the
 * first-agent flow relies on them entirely. */
export function useWizardDefaults(
  form: AgentForm,
  setForm: Dispatch<SetStateAction<AgentForm>>,
  catalogs: WizardCatalogs,
) {
  // Pick a first provider whenever one is missing (fresh form, or one that
  // only sets languages) or the current pick no longer matches the
  // language-filtered catalog — not just on "became invalid", which used to
  // skip straight past an empty provider forever.
  useEffect(() => {
    if (catalogs.loading || form.langs.length === 0) return;
    setForm((f) => {
      let next = { ...f };
      if (!providerStillValid(catalogs.sttProviders, f.sttProvider)) {
        next = { ...next, sttProvider: pickFirstProvider(catalogs.sttProviders) };
      }
      if (!providerStillValid(catalogs.ttsProviders, f.ttsProvider)) {
        next = { ...next, ttsProvider: pickFirstProvider(catalogs.ttsProviders) };
      }
      if (!providerStillValid(catalogs.llmProviders, f.llmProvider)) {
        next = { ...next, llmProvider: pickFirstProvider(catalogs.llmProviders) };
      }
      return next;
    });
  }, [
    catalogs.loading,
    catalogs.sttProviders,
    catalogs.ttsProviders,
    catalogs.llmProviders,
    form.langs,
    setForm,
  ]);

  useEffect(() => {
    if (catalogs.llmSettings) {
      const model = defaultModelFromSettings(catalogs.llmSettings);
      const models = modelOptionsFromSettings(catalogs.llmSettings);
      if (model && !form.llmModel) setForm((f) => ({ ...f, llmModel: model }));
      else if (form.llmModel && !models.some((m) => m.value === form.llmModel) && models[0]) {
        setForm((f) => ({ ...f, llmModel: models[0].value }));
      }
    }
  }, [catalogs.llmSettings, form.llmModel, setForm]);

  useEffect(() => {
    if (catalogs.ttsSettings) {
      // Voice options are per (model, language) via `capabilities` — omitting
      // these resolved against the wrong (arbitrary first) language, so a
      // validly-picked voice for the real language kept getting judged "not
      // in the list" and silently reset on every render.
      const voices = voiceOptionsFromSettings(catalogs.ttsSettings, form.ttsModel, form.langs[0]);
      if (voices.length && !form.voice) setForm((f) => ({ ...f, voice: voices[0]!.id }));
      else if (form.voice && !voices.some((v) => v.id === form.voice) && voices[0]) {
        setForm((f) => ({ ...f, voice: voices[0].id }));
      }
    }
  }, [catalogs.ttsSettings, form.voice, form.ttsModel, form.langs, setForm]);

  useEffect(() => {
    if (catalogs.sttSettings) {
      const model = defaultModelFromSettings(catalogs.sttSettings);
      const models = modelOptionsFromSettings(catalogs.sttSettings);
      if (model && !form.sttModel) setForm((f) => ({ ...f, sttModel: model }));
      else if (form.sttModel && !models.some((m) => m.value === form.sttModel) && models[0]) {
        setForm((f) => ({ ...f, sttModel: models[0].value }));
      }
    }
  }, [catalogs.sttSettings, form.sttModel, setForm]);

  useEffect(() => {
    if (catalogs.ttsSettings) {
      const model = defaultModelFromSettings(catalogs.ttsSettings);
      const models = modelOptionsFromSettings(catalogs.ttsSettings);
      if (model && !form.ttsModel) setForm((f) => ({ ...f, ttsModel: model }));
      else if (form.ttsModel && !models.some((m) => m.value === form.ttsModel) && models[0]) {
        setForm((f) => ({ ...f, ttsModel: models[0].value }));
      }
    }
  }, [catalogs.ttsSettings, form.ttsModel, setForm]);
}
