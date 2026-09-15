import { requireUser } from "@/lib/auth";
import { Rail, MobileNav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="app">
        <Rail role={user.role} name={user.fullName} />
        <div className="main">
          <main id="main-content" tabIndex={-1} className="content">{children}</main>
        </div>
      </div>
      <MobileNav role={user.role} />
    </>
  );
}
