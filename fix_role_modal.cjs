const fs = require('fs');

let content = fs.readFileSync('src/components/RoleLoginModal.tsx', 'utf8');
content = content.replace(
  "const [selectedStaffId, setSelectedStaffId] = useState<string>(staffList[2]?.id || 'usr-003');",
  "const [selectedStaffId, setSelectedStaffId] = useState<string>(staffList[0]?.id || '');"
);
content = content.replace(
  "const [selectedBranchId, setSelectedBranchId] = useState<string>('br-soweto');",
  "const [selectedBranchId, setSelectedBranchId] = useState<string>(branches[0]?.id || '');"
);
fs.writeFileSync('src/components/RoleLoginModal.tsx', content);
