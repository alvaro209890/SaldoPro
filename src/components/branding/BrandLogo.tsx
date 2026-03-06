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
            className={`h-9 w-9 rounded-full object-cover ${className}`}
        />
    );
}
