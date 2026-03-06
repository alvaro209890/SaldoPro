interface BrandLogoProps {
    className?: string;
    alt?: string;
}

export function BrandLogo({ className = '', alt = 'Logo SaldoPro' }: BrandLogoProps) {
    return (
        <img
            src="/logo-dark.png"
            alt={alt}
            loading="eager"
            decoding="async"
            className={`h-9 w-9 rounded-full bg-slate-950/80 object-cover ring-1 ring-cyan-300/35 shadow-[0_0_18px_rgba(34,211,238,0.28)] ${className}`}
        />
    );
}
