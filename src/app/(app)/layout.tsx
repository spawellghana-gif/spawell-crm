import { requireUser } from "@/lib/auth";
import { Rail, MobileNav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <div className="app">
        <Rail role={user.role} name={user.fullName} />
        <div className="main">
          <main className="content">{children}</main>
        </div>
      </div>
      <MobileNav role={user.role} />
    </>
  );
}
