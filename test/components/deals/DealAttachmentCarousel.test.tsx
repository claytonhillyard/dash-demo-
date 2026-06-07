import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealAttachmentCarousel } from "@/components/deals/DealAttachmentCarousel";
import type { DealAttachmentView } from "@/db/dealAttachments";

// jsdom doesn't implement next/image's required loader URLs; the shim renders
// a plain <img> so width/height/href assertions all work as expected.
vi.mock("next/image", () => ({
  default: (p: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...p} />;
  },
}));

const noopActions = {
  uploadAttachment: vi.fn(async (_fd: FormData) => ({ ok: true as const })),
  deleteAttachment: vi.fn(async (_i: { attachmentId: number }) => ({ ok: true as const })),
};

function att(over: Partial<DealAttachmentView>): DealAttachmentView {
  return {
    id: 1, dealId: 1, uploadedByOrgId: 1, kind: "image",
    storageKey: "k", mimeType: "image/jpeg", sizeBytes: 1024,
    altText: "photo", createdAt: new Date(), ...over,
  };
}

describe("DealAttachmentCarousel", () => {
  it("returns null when there are no attachments AND viewer is not owner", () => {
    const { container } = render(<DealAttachmentCarousel
      dealId={1} isOwner={false} attachments={[]} signedUrls={new Map()} actions={noopActions}
    />);
    expect(container.firstChild).toBeNull();
  });

  it("renders thumbnails for images", () => {
    render(<DealAttachmentCarousel
      dealId={1} isOwner={false}
      attachments={[att({ id: 1, altText: "front" }), att({ id: 2, altText: "side" })]}
      signedUrls={new Map([[1, "https://stub/1"], [2, "https://stub/2"]])}
      actions={noopActions}
    />);
    expect(screen.getAllByLabelText("attachment thumbnail")).toHaveLength(2);
  });

  it("renders cert as download link", () => {
    render(<DealAttachmentCarousel
      dealId={1} isOwner={false}
      attachments={[att({ id: 7, kind: "cert", mimeType: "application/pdf", altText: null })]}
      signedUrls={new Map([[7, "https://stub/7.pdf"]])}
      actions={noopActions}
    />);
    const link = screen.getByText(/cert-7/);
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("href", "https://stub/7.pdf");
  });

  it("shows + Add image and + Add cert ONLY for owner", () => {
    const { rerender } = render(<DealAttachmentCarousel
      dealId={1} isOwner={true} attachments={[]} signedUrls={new Map()} actions={noopActions}
    />);
    expect(screen.getByLabelText("add image")).toBeInTheDocument();
    expect(screen.getByLabelText("add cert")).toBeInTheDocument();
    rerender(<DealAttachmentCarousel
      dealId={1} isOwner={false} attachments={[att({ id: 1 })]} signedUrls={new Map([[1, "x"]])} actions={noopActions}
    />);
    expect(screen.queryByLabelText("add image")).toBeNull();
    expect(screen.queryByLabelText("add cert")).toBeNull();
  });

  it("delete button click fires deleteAttachment with the right id", async () => {
    const actions = { ...noopActions, deleteAttachment: vi.fn(async () => ({ ok: true as const })) };
    render(<DealAttachmentCarousel
      dealId={1} isOwner={true}
      attachments={[att({ id: 42 })]}
      signedUrls={new Map([[42, "x"]])}
      actions={actions}
    />);
    fireEvent.click(screen.getByLabelText("delete attachment 42"));
    await waitFor(() => expect(actions.deleteAttachment).toHaveBeenCalledWith({ attachmentId: 42 }));
  });

  it("clicking an image opens the lightbox; clicking close closes it", () => {
    render(<DealAttachmentCarousel
      dealId={1} isOwner={false}
      attachments={[att({ id: 1, altText: "front" })]}
      signedUrls={new Map([[1, "https://stub/1"]])}
      actions={noopActions}
    />);
    fireEvent.click(screen.getByLabelText(/Open front/));
    expect(screen.getByLabelText("image lightbox")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("close lightbox"));
    expect(screen.queryByLabelText("image lightbox")).toBeNull();
  });

  it("Esc key closes the lightbox", () => {
    render(<DealAttachmentCarousel
      dealId={1} isOwner={false}
      attachments={[att({ id: 1, altText: "front" })]}
      signedUrls={new Map([[1, "https://stub/1"]])}
      actions={noopActions}
    />);
    fireEvent.click(screen.getByLabelText(/Open front/));
    expect(screen.getByLabelText("image lightbox")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("image lightbox")).toBeNull();
  });

  it("renders alert when upload returns ok:false", async () => {
    const actions = {
      ...noopActions,
      uploadAttachment: vi.fn(async (_fd: FormData) => ({ ok: false as const, error: "Forbidden" })),
    };
    render(<DealAttachmentCarousel
      dealId={1} isOwner={true} attachments={[]} signedUrls={new Map()} actions={actions}
    />);
    // Trigger the hidden input via the actual button
    fireEvent.click(screen.getByLabelText("add image"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], "f.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/forbidden/i));
  });
});
