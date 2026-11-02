export type PageQuery = {
  page?: string | number;
  pageSize?: string | number;
};

export function pagination(query: PageQuery) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}
