import React from "react";

interface TabBarLeadingLayoutProps {
  children: React.ReactNode;
}

export const TabBarLeadingLayout: React.FC<TabBarLeadingLayoutProps> = ({
  children,
}) => <div className="flex items-center gap-1 pl-1.5 pr-2">{children}</div>;

export default TabBarLeadingLayout;
