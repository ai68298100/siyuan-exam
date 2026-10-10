/** 构造思源可持久化的自定义页签描述；运行时对象不得放入 custom.data。 */
export function createExamTabDescriptor(pluginName: string, type: string, icon: string, title: string) {
  return {
    id: `${pluginName}${type}`,
    icon,
    title,
  };
}
