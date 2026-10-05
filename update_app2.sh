#!/bin/bash
sed -i "s/import { UserSession, UserRole, OrderRecord, ProductItem, StaffMember, SupplierRecord, CustomerRecord, RestockRequest } from '.\/types';/import { UserSession, UserRole, OrderRecord, ProductItem, StaffMember, SupplierRecord, CustomerRecord, RestockRequest, Branch } from '.\/types';/" src/App.tsx
