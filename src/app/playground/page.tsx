import { Playground } from "@/components/playground";

export default function PlaygroundPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="kicker">Playground</p>
        <h1 className="mt-3 font-mono text-3xl">Try your key</h1>
        <p className="mt-3 max-w-2xl text-mid">
          Paste a Switchboard key from <a className="text-acid" href="/dashboard">My access</a>. The key stays in this browser tab. Try a message with
          an email address or phone number to watch the router move it to the Tinfoil enclave.
        </p>
      </div>
      <Playground />
    </div>
  );
}
