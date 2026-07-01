import api from '../services/api';

export async function getMenuOfficialGroup() {
  try {
    const res = await api.get('/public/menu-official-group');
    const data = res.data;
    if (!data || !data.id) return null;
    return {
      id: Number(data.id),
      name: String(data.name || ''),
      logo_path: data.logo_path ? String(data.logo_path) : null,
    };
  } catch (_) {
    return null;
  }
}
