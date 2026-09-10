export interface NavigationItem {
  title: string
  icon: string
  route: string
  selected?: boolean
  permission?: string // Optional permission key for role-based access
}

export interface NavigationGroup {
  title: string
  icon: string
  permission?: string // Optional permission key for the entire group
  children: NavigationItem[]
}

export const navigationConfig: NavigationGroup[] = [
  {
    title: 'My Account',
    icon: 'mdi-account',
    children: [
       {
        title: 'Home',
        icon: 'mdi-home',
        route: '/account/home',
        permission: 'admin.dashboard.view'
      },
      {
        title: 'Settings',
        icon: 'mdi-cog-outline',
        route: '/account/settings'
      },
    ]
  },
  {
    title: 'Teacher Tools',
    icon: 'mdi-school',
    permission: 'teacher.access',
    children: [
      {
        title: 'Answer Keys',
        icon: 'mdi-key',
        route: '/teachertab/teacher-answer-key',
        permission: 'teacher.answerkey.manage'
      },
      {
        title: 'My Students',
        icon: 'mdi-account-group',
        route: '/teachertab/teacher-students',
        permission: 'teacher.students.view'
      }
    ]
  },
  {
    title: 'Admin Controls',
    icon: 'mdi-cog',
    permission: 'admin.access',
    children: [

      {
        title: 'User Management',
        icon: 'mdi-account-multiple',
        route: '/admin/user-management',
        permission: 'admin.users.manage'
      },
      {
        title: 'User Roles',
        icon: 'mdi-account-key',
        route: '/admin/user-roles',
        permission: 'admin.roles.manage'
      },
      {
        title: 'Announcements',
        icon: 'mdi-bullhorn',
        route: '/admin/announcements',
        permission: 'admin.announcements.manage'
      },
    ]
  },

]

// Helper function to get all permissions from navigation config
export const getAllPermissions = (): string[] => {
  const permissions: string[] = []

  navigationConfig.forEach(group => {
    if (group.permission) {
      permissions.push(group.permission)
    }

    group.children.forEach(item => {
      if (item.permission) {
        permissions.push(item.permission)
      }
    })
  })

  return [...new Set(permissions)] // Remove duplicates
}

// Helper function to get navigation items with selected state
export const getNavigationWithSelection = (selectedPermissions: string[] = []): NavigationGroup[] => {
  return navigationConfig.map(group => ({
    ...group,
    children: group.children.map(item => ({
      ...item,
      selected: selectedPermissions.includes(item.permission || item.route)
    }))
  }))
}

// Map a route path to the permission(s) required to access it
export const getPermissionForRoute = (path: string): string[] => {
  for (const group of navigationConfig) {
    for (const item of group.children) {
      if (item.route === path) {
        const permissions: string[] = []
        if (group.permission) {
          permissions.push(group.permission)
        }
        if (item.permission) {
          permissions.push(item.permission)
        }
        return permissions
      }
    }
  }
  return []
}
