use super::*;
use std::path::PathBuf;

#[test]
fn test_extract_interface_props() {
    let mut extractor = PropsExtractor::new().unwrap();
    // Note: In raw strings, line 1 starts after the opening quote
    let code = r#"interface ButtonProps {
    /** The button variant */
    variant: "primary" | "secondary";
    /** Button size */
    size?: "small" | "medium" | "large";
    /** Whether the button is disabled */
    disabled?: boolean;
    /** Click handler */
    onClick: () => void;
    /** Button content */
    children: ReactNode;
}

/**
 * A reusable button component
 */
function Button(props: ButtonProps) {
    return <button>{props.children}</button>;
}
"#;

    // function Button is on line 17 (0-indexed: 16, 1-indexed: 17)
    let result = extractor.extract_props(
        &PathBuf::from("test.tsx"),
        code,
        "Button",
        17,
        &ComponentKind::FunctionDef,
    );

    assert_eq!(result.props_type_name, Some("ButtonProps".to_string()));
    assert_eq!(result.props.len(), 5);

    // Check variant prop
    let variant = result.props.iter().find(|p| p.name == "variant").unwrap();
    assert!(variant.required);
    assert!(matches!(variant.prop_type, PropType::StringLiteral(_)));

    // Check size prop (optional)
    let size = result.props.iter().find(|p| p.name == "size").unwrap();
    assert!(!size.required);

    // Check component description
    assert!(result.description.is_some());
    assert!(result.description.unwrap().contains("reusable button"));
}

#[test]
fn test_extract_arrow_function_props() {
    let mut extractor = PropsExtractor::new().unwrap();
    let code = r#"
interface CardProps {
    title: string;
    subtitle?: string;
}

const Card = (props: CardProps) => {
    return <div>{props.title}</div>;
};
"#;

    let result = extractor.extract_props(
        &PathBuf::from("test.tsx"),
        code,
        "Card",
        7,
        &ComponentKind::ArrowDef,
    );

    assert_eq!(result.props_type_name, Some("CardProps".to_string()));
    assert_eq!(result.props.len(), 2);
}

#[test]
fn test_extract_forward_ref_props() {
    let mut extractor = PropsExtractor::new().unwrap();
    let code = r#"
import { forwardRef } from "react";

export interface ButtonProps {
    /** Button type */
    type?: "primary" | "secondary";
    /** Button size */
    size?: "small" | "default" | "large";
    /** Loading state */
    loading?: boolean;
    /** Button content */
    children?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ type = "default", size = "default", loading, children }, ref) => {
        return <button ref={ref}>{children}</button>;
    }
);
"#;

    let result = extractor.extract_props(
        &PathBuf::from("test.tsx"),
        code,
        "Button",
        17, // Line where const Button = forwardRef... is
        &ComponentKind::ArrowDef,
    );

    assert_eq!(result.props_type_name, Some("ButtonProps".to_string()));
    assert_eq!(result.props.len(), 4);

    // Check type prop
    let type_prop = result.props.iter().find(|p| p.name == "type").unwrap();
    assert!(!type_prop.required); // optional

    // Check children prop
    let children = result.props.iter().find(|p| p.name == "children").unwrap();
    // ReactNode can be parsed as ReactNode or as a TypeRef if parsing is ambiguous
    assert!(
        matches!(children.prop_type, PropType::ReactNode)
            || matches!(&children.prop_type, PropType::TypeRef(s) if s.contains("ReactNode"))
    );
}

#[test]
fn test_extract_memo_props() {
    let mut extractor = PropsExtractor::new().unwrap();
    let code = r#"
import { memo } from "react";

interface CardProps {
    title: string;
}

const Card = memo<CardProps>(({ title }) => {
    return <div>{title}</div>;
});
"#;

    let result = extractor.extract_props(
        &PathBuf::from("test.tsx"),
        code,
        "Card",
        8,
        &ComponentKind::ArrowDef,
    );

    assert_eq!(result.props_type_name, Some("CardProps".to_string()));
    assert_eq!(result.props.len(), 1);
}
