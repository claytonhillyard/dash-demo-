"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import type { DealAttachmentView } from "@/db/dealAttachments";

export type DealAttachmentCarouselProps = {
  dealId: number;
  isOwner: boolean;
  attachments: DealAttachmentView[];
  signedUrls: Map<number, string>;
  actions: {
    uploadAttachment: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
    deleteAttachment: (input: { attachmentId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

export function DealAttachmentCarousel(props: DealAttachmentCarouselProps) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const certInputRef = useRef<HTMLInputElement>(null);

  // Esc-to-close the lightbox. `<dialog open>` (declarative) does NOT activate
  // the browser's native modal Esc handling — that only fires when the dialog
  // is opened via `.showModal()`. Without this, the spec's "Esc/click-outside
  // closes" promise was only half-true.
  useEffect(() => {
    if (lightboxId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxId]);

  const images = props.attachments.filter((a) => a.kind === "image");
  const certs = props.attachments.filter((a) => a.kind === "cert");
  if (images.length === 0 && certs.length === 0 && !props.isOwner) return null;

  const triggerUpload = (kind: "image" | "cert", file: File) => {
    setActionError(null);
    const fd = new FormData();
    fd.set("dealId", String(props.dealId));
    fd.set("kind", kind);
    fd.set("file", file);
    startTransition(async () => {
      const res = await props.actions.uploadAttachment(fd);
      if (!res.ok) setActionError(res.error);
    });
  };

  const lightboxAttachment = lightboxId !== null
    ? props.attachments.find((a) => a.id === lightboxId)
    : null;

  return (
    <div aria-label="deal attachments" className="mb-2">
      {actionError && (
        <p role="alert" className="text-xs text-rose-400 mb-1">{actionError}</p>
      )}

      {images.length > 0 && (
        <div className="overflow-x-auto flex gap-2 pb-1">
          {images.map((a) => (
            <div key={a.id} aria-label="attachment thumbnail" className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setLightboxId(a.id)}
                className="block"
                aria-label={`Open ${a.altText ?? "deal photo"}`}
              >
                <Image
                  src={props.signedUrls.get(a.id) ?? ""}
                  alt={a.altText ?? "deal photo"}
                  width={120}
                  height={120}
                  className="rounded object-cover"
                />
              </button>
              {props.isOwner && (
                <button
                  aria-label={`delete attachment ${a.id}`}
                  className="absolute top-0 right-0 bg-zinc-900/80 text-rose-400 text-xs px-1 rounded-tr rounded-bl opacity-0 hover:opacity-100"
                  disabled={pending}
                  onClick={() => {
                    setActionError(null);
                    startTransition(async () => {
                      const res = await props.actions.deleteAttachment({ attachmentId: a.id });
                      if (!res.ok) setActionError(res.error);
                    });
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {props.isOwner && (
            <button
              aria-label="add image"
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="flex-shrink-0 w-[120px] h-[120px] border border-dashed border-zinc-700 rounded text-zinc-400 hover:text-zinc-100 text-xs"
              disabled={pending}
            >
              + Add image
            </button>
          )}
        </div>
      )}

      {props.isOwner && images.length === 0 && (
        <button
          aria-label="add image"
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="w-[120px] h-[120px] border border-dashed border-zinc-700 rounded text-zinc-400 hover:text-zinc-100 text-xs mb-1"
          disabled={pending}
        >
          + Add image
        </button>
      )}

      {certs.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs mt-1">
          {certs.map((c) => (
            <li key={c.id} aria-label="attachment cert" className="flex items-center gap-1">
              <a
                href={props.signedUrls.get(c.id) ?? "#"}
                download
                className="text-zinc-200 hover:text-amber-300 underline"
              >
                📄 cert-{c.id}
              </a>
              {props.isOwner && (
                <button
                  aria-label={`delete attachment ${c.id}`}
                  className="text-zinc-500 hover:text-rose-400"
                  disabled={pending}
                  onClick={() => {
                    setActionError(null);
                    startTransition(async () => {
                      const res = await props.actions.deleteAttachment({ attachmentId: c.id });
                      if (!res.ok) setActionError(res.error);
                    });
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {props.isOwner && (
        <button
          aria-label="add cert"
          type="button"
          onClick={() => certInputRef.current?.click()}
          className="text-xs text-zinc-400 hover:text-zinc-100 mt-1"
          disabled={pending}
        >
          + Add cert
        </button>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) triggerUpload("image", f);
          if (e.target) e.target.value = "";
        }}
      />
      <input
        ref={certInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) triggerUpload("cert", f);
          if (e.target) e.target.value = "";
        }}
      />

      {lightboxAttachment && (
        <dialog open className="bg-zinc-900/95 fixed inset-0 z-50 flex items-center justify-center p-4 w-full h-full"
                aria-label="image lightbox"
                aria-modal="true"
                onClick={() => setLightboxId(null)}>
          {/* Stop propagation on the image so clicking the photo itself
              doesn't trigger the dialog's onClick (which would close the
              lightbox while the user is trying to look at the image). */}
          <span
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-full max-h-full"
          >
            <Image
              src={props.signedUrls.get(lightboxAttachment.id) ?? ""}
              alt={lightboxAttachment.altText ?? "deal photo"}
              width={800}
              height={800}
              className="max-w-full max-h-full object-contain rounded"
            />
          </span>
          <button
            type="button"
            aria-label="close lightbox"
            className="absolute top-3 right-3 text-zinc-200 hover:text-rose-400 text-xl"
            onClick={(e) => { e.stopPropagation(); setLightboxId(null); }}
          >
            ×
          </button>
        </dialog>
      )}
    </div>
  );
}
