import { Panel } from "@/components/Panel";

export function BusinessPlaceholder({ title, testid }: { title: string; testid: string }) {
  return (
    <div data-testid={testid}>
      <Panel title={title} state="unwired" />
    </div>
  );
}
