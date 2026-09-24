import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell, BootGate } from "@/components/cl/shell";

// Client-only: the enclave state lives in the browser (and the local Crypto Core).
export const Route = createFileRoute("/_app")({
  ssr: false,
  component: () => (
    <BootGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </BootGate>
  ),
});
