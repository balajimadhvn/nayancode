/* Replacement for AutoDock-Vina/src/lib/parallel.h (Apache-2.0, same licence as Vina): std::thread instead of boost::thread,
 * so the WebAssembly build needs no compiled Boost.Thread. Tasks are independent and seeded per task, so the result does not
 * depend on how many threads run or on scheduling. With one thread the tasks run inline (no threads needed: works without
 * cross-origin isolation). */
#ifndef VINA_PARALLEL_H
#define VINA_PARALLEL_H
#include <atomic>
#include <thread>
#include <vector>
#include "common.h"

template<typename F, bool Sync = false>
struct parallel_for {
	parallel_for(const F* f, sz num_threads) : m_f(f), num_threads(num_threads) {}
	void run(sz size) {
		if (num_threads <= 1 || size <= 1) { for (sz i = 0; i < size; i++) (*m_f)(i); return; }
		std::atomic<sz> next(0);
		std::vector<std::thread> ts;
		for (sz t = 0; t < num_threads && t < size; t++)
			ts.emplace_back([&]() { for (;;) { sz i = next++; if (i >= size) break; (*m_f)(i); } });
		for (auto& t : ts) t.join();
	}
private:
	const F* m_f;
	sz num_threads;
};

template<typename F, typename Container, typename Input, bool Sync = false>
struct parallel_iter {
	parallel_iter(const F* f, sz num_threads) : a(f), pf(&a, num_threads) {}
	void run(Container& v) { a.v = &v; pf.run(v.size()); }
private:
	struct aux {
		const F* f; Container* v;
		aux(const F* f) : f(f), v(NULL) {}
		void operator()(sz i) const { VINA_CHECK(v); (*f)((*v)[i]); }
	};
	aux a;
	parallel_for<aux, Sync> pf;
};
#endif
