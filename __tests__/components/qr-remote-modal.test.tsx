import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import QRRemoteModal from "@/components/presenter/QRRemoteModal";

const mockToDataURL = jest.fn();

jest.mock("qrcode", () => ({
  __esModule: true,
  default: {
    toDataURL: (...args: unknown[]) => mockToDataURL(...args),
  },
}));

describe("QRRemoteModal", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useRealTimers();
    mockToDataURL.mockReset();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("shows loading while the QR is being generated instead of an error", async () => {
    let resolveQr: ((value: string) => void) | undefined;
    mockToDataURL.mockReturnValue(new Promise((resolve) => {
      resolveQr = resolve;
    }));
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ ip: "192.168.1.55" }),
    });

    await act(async () => {
      render(
        <QRRemoteModal
          open
          onClose={() => {}}
          sessionId="session123"
          connected={false}
          lang="es"
          onStartSession={async () => "session123"}
        />
      );
      await Promise.resolve();
    });

    expect(screen.queryByText("Error al generar el código QR.")).not.toBeInTheDocument();

    await act(async () => {
      resolveQr?.("data:image/png;base64,qr");
      await Promise.resolve();
    });

    expect(await screen.findByAltText("QR Code")).toBeInTheDocument();
  });

  it("uses the detected LAN IP instead of a loopback origin for the mobile URL", async () => {
    jest.useFakeTimers();
    mockToDataURL.mockResolvedValue("data:image/png;base64,qr");
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("route compiling"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ip: "192.168.1.55" }),
      });

    await act(async () => {
      render(
        <QRRemoteModal
          open
          onClose={() => {}}
          sessionId="session123"
          connected={false}
          lang="en"
          onStartSession={async () => "session123"}
        />
      );
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => {
      expect(mockToDataURL).toHaveBeenCalledWith(
        expect.stringContaining("192.168.1.55/remote?session=session123"),
        expect.any(Object),
      );
    });
  });
});