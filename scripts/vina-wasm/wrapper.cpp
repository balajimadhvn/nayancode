// Thin C entry points around the AutoDock Vina 1.2.7 library class (Apache-2.0), compiled with Emscripten.
// vina_dock() / vina_score() return a malloc'ed UTF-8 string; the caller frees it with vina_free().
// Errors are returned as a string starting with "ERROR:".
#include <emscripten.h>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <sstream>
#include <string>
#include <vector>
#include "vina.h"

EM_JS(void, js_progress, (double p), { if (Module.onProgress) Module.onProgress(p); });

static char* dup(const std::string& s) { char* r = (char*)malloc(s.size() + 1); memcpy(r, s.c_str(), s.size() + 1); return r; }

extern "C" {
// receptor_path: PDBQT in the virtual FS. ligand: PDBQT text. Returns "VINA <version>\n<poses PDBQT>".
EMSCRIPTEN_KEEPALIVE char* vina_dock(const char* receptor_path, const char* ligand_pdbqt, double cx, double cy, double cz, double sx, double sy, double sz,
                                     int exhaustiveness, int n_poses, int seed, int cpu, double energy_range, const char* scoring) {
  try {
    std::function<void(double)> cb = [](double p) { js_progress(p); };
    Vina v(scoring, cpu, seed, 0, false, &cb);
    v.set_receptor(receptor_path);
    v.set_ligand_from_string(std::string(ligand_pdbqt));
    v.compute_vina_maps(cx, cy, cz, sx, sy, sz);
    v.global_search(exhaustiveness, n_poses, 1.0, 0);
    return dup(v.get_poses(n_poses, energy_range));
  } catch (const std::exception& e) { return dup(std::string("ERROR: ") + e.what()); }
  catch (...) { return dup("ERROR: Vina failed (receptor or ligand PDBQT may be malformed)"); }
}
// Score the input pose and its local optimum. Returns "<total> <inter> <intra> ...\n<opt total> ..."
EMSCRIPTEN_KEEPALIVE char* vina_score(const char* receptor_path, const char* ligand_pdbqt, double cx, double cy, double cz, double sx, double sy, double sz, const char* scoring) {
  try {
    Vina v(scoring, 1, 1, 0);
    v.set_receptor(receptor_path);
    v.set_ligand_from_string(std::string(ligand_pdbqt));
    v.compute_vina_maps(cx, cy, cz, sx, sy, sz);
    std::ostringstream o;
    std::vector<double> e = v.score(); for (double x : e) o << x << ' '; o << '\n';
    e = v.optimize(); for (double x : e) o << x << ' '; o << '\n';
    return dup(o.str());
  } catch (const std::exception& e) { return dup(std::string("ERROR: ") + e.what()); }
  catch (...) { return dup("ERROR: Vina failed"); }
}
EMSCRIPTEN_KEEPALIVE void vina_free(char* p) { free(p); }
}
