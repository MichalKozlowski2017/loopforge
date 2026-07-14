import { Suspense } from "react";
import HomePage from "./HomePage";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-zinc-500">
          Ładowanie…
        </div>
      }
    >
      <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <HomePage />
      </div>
    </Suspense>
  );
}
