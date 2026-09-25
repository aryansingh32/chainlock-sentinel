import { createFileRoute } from "@tanstack/react-router";
import { BootGate } from "@/components/cl/shell";
import { RoleSelectPage } from "@/components/pages/role-select";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ChainLock — Secure Device Unlock" },
      {
        name: "description",
        content: "Role selection and device-bound key unlock for ChainLock + SENTINEL.",
      },
    ],
  }),
  component: () => (
    <BootGate>
      <RoleSelectPage />
    </BootGate>
  ),
});
