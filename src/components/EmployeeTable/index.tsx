/**
 * EmployeeTable — display-oriented table for employee records.
 *
 * Built on the shared `Table` component. Ships with a sensible default
 * column set (avatar + name, email, department, title, status) and falls
 * back to a caller-supplied `columns` prop when present.
 */
import React, { useMemo } from "react";

import Avatar from "@src/components/Avatar";
import StatusBadge from "@src/components/StatusBadge";
import type { StatusType } from "@src/components/StatusBadge";
import Table from "@src/components/Table";
import type { TableColumn, TableProps } from "@src/components/Table";

export interface Employee {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  status: StatusType;
  avatarUrl?: string;
}

export interface EmployeeTableProps extends Omit<
  TableProps<Employee>,
  "columns" | "data"
> {
  employees: Employee[];
  /** Override the default column set (avatar+name / email / department / title / status). */
  columns?: TableColumn<Employee>[];
}

const getInitials = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const EmployeeTable: React.FC<EmployeeTableProps> = ({
  employees,
  columns,
  ...tableProps
}) => {
  const defaultColumns = useMemo<TableColumn<Employee>[]>(
    () => [
      {
        key: "name",
        title: "Name",
        dataIndex: "name",
        render: (_value, record) => (
          <div className="flex items-center gap-2">
            <Avatar size={28} src={record.avatarUrl}>
              {getInitials(record.name)}
            </Avatar>
            <span className="font-medium text-text-1">{record.name}</span>
          </div>
        ),
      },
      {
        key: "email",
        title: "Email",
        dataIndex: "email",
      },
      {
        key: "department",
        title: "Department",
        dataIndex: "department",
        sorter: true,
      },
      {
        key: "title",
        title: "Title",
        dataIndex: "title",
      },
      {
        key: "status",
        title: "Status",
        dataIndex: "status",
        render: (_value, record) => <StatusBadge status={record.status} />,
      },
    ],
    []
  );

  return (
    <Table<Employee>
      columns={columns ?? defaultColumns}
      data={employees}
      rowKey="id"
      {...tableProps}
    />
  );
};

export default EmployeeTable;
