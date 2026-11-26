package jsonv

import "testing"

func mustPanicFrozen(t *testing.T, name string, f func()) {
	t.Helper()
	defer func() {
		r := recover()
		if _, ok := r.(*FrozenError); !ok {
			t.Fatalf("%s: want *FrozenError, got %v", name, r)
		}
	}()
	f()
}

func TestFreezeGuardsEveryWrite(t *testing.T) {
	inner := NewObject("a", 1.0)
	o := NewObject("k", inner, "list", []any{NewObject("z", 1.0)})
	Freeze(o)
	if !o.Frozen() || !inner.Frozen() || !o.Arr("list")[0].(*Object).Frozen() {
		t.Fatal("freeze must be deep")
	}
	mustPanicFrozen(t, "set", func() { o.Set("k", 1.0) })
	mustPanicFrozen(t, "set new", func() { o.Set("new", 1.0) })
	mustPanicFrozen(t, "delete", func() { o.Delete("k") })
	mustPanicFrozen(t, "deleteAll", func() { o.DeleteAll([]string{"k"}) })
	mustPanicFrozen(t, "nested", func() { inner.Set("a", 2.0) })
	if o.Delete("missing"); o.Len() != 2 {
		t.Fatal("a delete of a missing key must not change anything")
	}
}

func TestCloneAndSpreadThawAndShareCorrectly(t *testing.T) {
	inner := NewObject("a", 1.0)
	o := NewObject("k", inner)
	Freeze(o)
	c := Clone(o).(*Object)
	c.Set("k", 3.0)
	c.Obj("k")
	sp := o.Spread()
	sp.Set("x", 1.0)
	if sp.Obj("k") != inner {
		t.Fatal("spread shares nested objects")
	}
	mustPanicFrozen(t, "shared nested", func() { sp.Obj("k").Set("a", 9.0) })
	d := Clone(o).(*Object)
	d.Obj("k").Set("a", 2.0)
	if inner.Num("a") != 1 {
		t.Fatal("clone must not write through to the frozen original")
	}
}

func TestJournalRecordsAddsSetsAndDeletes(t *testing.T) {
	o := NewObject("a", 1.0, "b", 2.0, "c", 3.0)
	o.StartJournal()
	o.Set("a", 5.0)
	o.Set("d", 1.0)
	o.Delete("b")
	o.DeleteAll([]string{"c", "zz"})
	o.Set("b", 1.0)
	got := ""
	for _, e := range o.Journal() {
		got += e.Key + string(e.Kind) + " "
	}
	if got != "aS dA bD cD bA " {
		t.Fatalf("journal %q", got)
	}
	if o.Spread().Journal() != nil || Clone(o).(*Object).Journal() != nil {
		t.Fatal("copies must not inherit the journal")
	}
}
