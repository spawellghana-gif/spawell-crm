import Image from "next/image";

export function BrandLogo() {
  return (
    <span className="brand-logo">
      <Image
        src="/spawellghana-logo.jpg"
        alt="SpaWell Ghana — The care you deserve!"
        width={1536}
        height={1536}
        sizes="(max-width: 900px) 260px, 184px"
        priority
      />
    </span>
  );
}
